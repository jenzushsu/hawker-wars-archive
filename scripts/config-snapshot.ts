import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTIONS, PROVIDERS, CONTRACT_VERSIONS, POC_CONFIG, DEMAND_CONFIG, RULES_CONFIG, SCORE_CONFIG, TRIAL_CONFIG, STATIC_TASK_CONFIG } from '../packages/shared/src/config.js';

// Configuration identity only. This is not the P2 simulator-state checksum.
export const configSnapshot = {
  schemaVersion: 'p0-config-1', versions: CONTRACT_VERSIONS,
  actions: ACTIONS, providers: PROVIDERS, mechanics: POC_CONFIG, demand: DEMAND_CONFIG,
  baseline: RULES_CONFIG, scorer: SCORE_CONFIG, evaluation: TRIAL_CONFIG, staticTasks: STATIC_TASK_CONFIG,
};
export function canonicalConfig(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalConfig).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalConfig((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('Configuration must contain only finite JSON data');
}
export const configurationHash = createHash('sha256').update('hawker-wars|p0-config-1\n').update(canonicalConfig(configSnapshot)).digest('hex');
export function readProjectJson(relative: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8')) as unknown;
}
