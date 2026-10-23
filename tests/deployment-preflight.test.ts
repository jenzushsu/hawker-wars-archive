import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { inspectDeployment } from '../scripts/deployment-preflight.ts';
import { LiveStore } from '../packages/live/src/store.ts';

const worker = { SUPABASE_URL: 'https://staging.example.test/', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role-key' };
const web = { ...worker, HAWKER_PUBLIC_ORIGIN: 'https://app.example.test', HAWKER_VOTE_SESSION_KEY: 'v'.repeat(43), HAWKER_OPERATOR_TOKEN: 'o'.repeat(43), HAWKER_OPERATOR_ID: 'staging-operator' };

describe('offline deployment preflight', () => {
  it('requires only worker credentials on the worker and all live-service settings on web', () => {
    const workerReport = inspectDeployment('worker', worker);
    expect(workerReport.status).toBe('configuration-format-passed');
    expect(workerReport.checks.map(check => check.variable)).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    expect(inspectDeployment('web', worker).checks.filter(check => check.status === 'missing').map(check => check.variable)).toEqual(['HAWKER_PUBLIC_ORIGIN', 'HAWKER_VOTE_SESSION_KEY', 'HAWKER_OPERATOR_TOKEN', 'HAWKER_OPERATOR_ID']);
    expect(inspectDeployment('web', web)).toMatchObject({ status: 'configuration-format-passed', hostedReadiness: 'not-verified', networkCalls: 0 });
  });

  it.each(['http://db.example.test', 'https://user:password@db.example.test', 'https://db.example.test/rest/v1', 'https://db.example.test?secret=bad', 'https://db.example.test#fragment', 'not-a-url'])('rejects invalid store URL consistently with LiveStore: %s', url => {
    expect(inspectDeployment('worker', { ...worker, SUPABASE_URL: url }).checks[0]?.status).toBe('invalid');
    expect(() => new LiveStore({ supabaseUrl: url, serviceRoleKey: worker.SUPABASE_SERVICE_ROLE_KEY })).toThrow();
  });

  it.each(['http://app.example.test', 'https://app.example.test/', 'https://app.example.test/path', 'https://user@host.test', 'https://app.example.test?x=y', 'https://app.example.test#x', 'https://APP.example.test', 'https://app.example.test:443'])('rejects nonexact voting origin: %s', origin => {
    const report = inspectDeployment('web', { ...web, HAWKER_PUBLIC_ORIGIN: origin });
    expect(report.checks.find(check => check.variable === 'HAWKER_PUBLIC_ORIGIN')?.status).toBe('invalid');
  });

  it('rejects missing/weak or malformed credentials and invalid audit identity without revealing values', () => {
    const bad = { SUPABASE_URL: 'https://private-canary.invalid/path', SUPABASE_SERVICE_ROLE_KEY: 'short-canary', HAWKER_PUBLIC_ORIGIN: '', HAWKER_OPERATOR_TOKEN: 'token-canary', HAWKER_VOTE_SESSION_KEY: `secret-canary-${'x'.repeat(43)}=`, HAWKER_OPERATOR_ID: 'actor canary' };
    const report = inspectDeployment('web', bad);
    expect(report.status).toBe('blocked');
    expect(report.checks.every(check => check.status !== 'configured')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('canary');
    expect(report.checks.find(check => check.variable === 'HAWKER_PUBLIC_ORIGIN')?.status).toBe('missing');
  });

  it('accepts runtime format boundaries but makes no claim about credential validity or entropy', () => {
    const environment = { ...web, SUPABASE_SERVICE_ROLE_KEY: 'a'.repeat(4096), HAWKER_OPERATOR_TOKEN: 'o'.repeat(128), HAWKER_VOTE_SESSION_KEY: 'v'.repeat(128), HAWKER_OPERATOR_ID: 'i'.repeat(128) };
    expect(inspectDeployment('web', environment).status).toBe('configuration-format-passed');
    expect(inspectDeployment('web', { ...environment, HAWKER_OPERATOR_TOKEN: 'o'.repeat(129) }).status).toBe('blocked');
    expect(inspectDeployment('worker', { ...worker, SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(15) }).status).toBe('blocked');
    expect(inspectDeployment('worker', { ...worker, SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(4097) }).status).toBe('blocked');
  });

  it('blocks obvious reuse of privileged secrets without exposing their value', () => {
    const duplicate = 'reused-secret-canary-'.repeat(3);
    const result = inspectDeployment('web', { ...web, SUPABASE_SERVICE_ROLE_KEY: duplicate, HAWKER_VOTE_SESSION_KEY: duplicate, HAWKER_OPERATOR_TOKEN: duplicate });
    expect(result.status).toBe('blocked');
    expect(result.checks.filter(check => check.status === 'invalid').map(check => check.variable)).toEqual(['SUPABASE_SERVICE_ROLE_KEY', 'HAWKER_VOTE_SESSION_KEY', 'HAWKER_OPERATOR_TOKEN']);
    expect(JSON.stringify(result)).not.toContain(duplicate);
  });

  it('does not perform network work, log secrets or inspect provider credentials', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Network forbidden'); });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const environment = { ...web, get TYPESAFE_API_KEY(): string { throw new Error('Provider access forbidden'); } };
      const result = inspectDeployment('web', environment);
      expect(result.status).toBe('configuration-format-passed');
      expect(JSON.stringify(result)).not.toContain(worker.SUPABASE_SERVICE_ROLE_KEY);
      expect(fetch).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); log.mockRestore(); }
  });

  it('reports CLI failures with nonzero exit codes and never echoes invalid arguments', () => {
    const run = (args: string[], environment: Record<string, string> = {}) => spawnSync(process.execPath,
      ['--import', 'tsx', 'scripts/deployment-preflight.ts', ...args], { cwd: process.cwd(), env: environment, encoding: 'utf8' });
    const missing = run(['--target', 'worker']);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).status).toBe('blocked');
    const configured = run(['--target', 'web'], web);
    expect(configured.status).toBe(0);
    expect(JSON.parse(configured.stdout).hostedReadiness).toBe('not-verified');
    const invalid = run(['--target', 'secret-argument-canary']);
    expect(invalid.status).toBe(2);
    expect(invalid.stderr).not.toContain('secret-argument-canary');
    expect(JSON.parse(invalid.stderr).status).toBe('invalid-invocation');
  });
});
