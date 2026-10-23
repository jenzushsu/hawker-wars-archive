import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export type DeploymentTarget = 'web' | 'worker';
type Environment = Readonly<Record<string, string | undefined>>;
type Check = { variable: string; status: 'configured' | 'missing' | 'invalid'; requirement: string };
type Rule = { variable: string; requirement: string; valid: (value: string) => boolean };

// Keep these format checks aligned with LiveStore, handleOperatorRequest and
// handleVoteRequest. They do not authenticate credentials or measure entropy.
const token = (value: string) => /^[A-Za-z0-9_-]{43,128}$/.test(value);
const common: Rule[] = [
  { variable: 'SUPABASE_URL', requirement: 'HTTPS root URL without user information, query or fragment', valid: value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && ['', '/'].includes(url.pathname);
    } catch { return false; }
  } },
  { variable: 'SUPABASE_SERVICE_ROLE_KEY', requirement: '16–4096 visible ASCII characters without whitespace', valid: value => /^[\x21-\x7e]{16,4096}$/.test(value) },
];
const web: Rule[] = [
  { variable: 'HAWKER_PUBLIC_ORIGIN', requirement: 'Exact HTTPS origin without trailing slash, path, query, fragment or user information', valid: value => {
    try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password; }
    catch { return false; }
  } },
  { variable: 'HAWKER_VOTE_SESSION_KEY', requirement: '43–128 base64url characters; independently generated secret required', valid: token },
  { variable: 'HAWKER_OPERATOR_TOKEN', requirement: '43–128 base64url characters; independently generated secret required', valid: token },
  { variable: 'HAWKER_OPERATOR_ID', requirement: '1–128 letters, digits, underscores or hyphens', valid: value => /^[A-Za-z0-9_-]{1,128}$/.test(value) },
];

/** Pure, offline inspection. No environment values are returned or logged. */
export function inspectDeployment(target: DeploymentTarget, environment: Environment) {
  const checks: Check[] = [...common, ...(target === 'web' ? web : [])].map(rule => {
    const value = environment[rule.variable];
    return { variable: rule.variable, status: value === undefined || value === '' ? 'missing' : rule.valid(value) ? 'configured' : 'invalid', requirement: rule.requirement };
  });
  if (target === 'web') {
    const secretNames = ['SUPABASE_SERVICE_ROLE_KEY', 'HAWKER_VOTE_SESSION_KEY', 'HAWKER_OPERATOR_TOKEN'];
    for (const check of checks) {
      if (secretNames.includes(check.variable) && environment[check.variable] &&
          secretNames.some(other => other !== check.variable && environment[other] === environment[check.variable])) {
        check.status = 'invalid';
        check.requirement = 'Use an independent secret; another required credential has the same value';
      }
    }
  }
  return {
    schemaVersion: 'deployment-preflight-1' as const,
    target,
    status: checks.every(check => check.status === 'configured') ? 'configuration-format-passed' as const : 'blocked' as const,
    checks,
    networkCalls: 0,
    hostedReadiness: 'not-verified' as const,
    scope: target === 'web' ? 'live-view-voting-and-operator-api' : 'rules-worker',
    limitations: ['Credential validity and secret entropy are not verified.', 'Migrations, hosted permissions, TLS, cookies, project configuration and worker supervision require staging acceptance.'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { target: { type: 'string' } }, strict: true, allowPositionals: false });
    if (values.target !== 'web' && values.target !== 'worker') throw new Error();
    const report = inspectDeployment(values.target, process.env);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'blocked' ? 1 : 0;
  } catch {
    console.error(JSON.stringify({ status: 'invalid-invocation', usage: 'pnpm exec tsx scripts/deployment-preflight.ts --target web|worker' }));
    process.exitCode = 2;
  }
}
