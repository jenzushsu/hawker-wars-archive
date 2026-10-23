import { versions } from 'node:process';
import { z } from 'zod';

const MAX_REQUEST_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 2_097_152;
const integer = z.number().int().safe().refine(value => !Object.is(value, -0));
const nonnegative = integer.refine(value => value >= 0);
const uuid = z.string().uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const classification = z.enum(['offline-contract', 'clean', 'stress', 'exhibition', 'replay']);
const policy = z.enum(['rules', 'jev', 'zoom', 'zoom-pro']);
const policyIds = z.array(policy).min(1).max(4).refine(values => new Set(values).size === values.length && values.includes('rules'));
const tick = integer.refine(value => value >= 0 && value <= 120);
const snapshot = z.object({ policies: z.array(z.object({
  policy_id: policy, cash_cents: nonnegative, profit_cents: integer, utility_points: integer,
  served: nonnegative, abandoned: nonnegative,
}).strict()).min(1).max(4).refine(values => new Set(values.map(item => item.policy_id)).size === values.length) }).strict();
const decision = z.object({ policy_id: policy, action: z.enum(['SERVE', 'COOK', 'RESTOCK', 'PROMOTE', 'WAIT']),
  source: z.enum(['rules', 'model']), fallback_reason: z.enum(['invalid', 'illegal', 'network', 'rate-limit', 'timeout', 'uncertain', 'budget', 'quota']).nullable(),
}).strict().refine(value => value.policy_id === 'rules' ? value.source === 'rules' && value.fallback_reason === null : value.source === 'model' ? value.fallback_reason === null : value.fallback_reason !== null);
// A private JSON envelope only, not validation of simulator recovery semantics.
const recovery = z.record(z.unknown()).refine(value => value.schemaVersion === 'recovery-1');
const lease = z.object({ fence: nonnegative.refine(value => value > 0), expires_at: z.string().datetime({ offset: true }) }).strict();
const publicSnapshot = z.object({ schemaVersion: z.literal('live-snapshot-1'), round_id: uuid, classification,
  tick: integer.refine(value => value >= -1 && value <= 120), sequence: nonnegative,
  status: z.enum(['running', 'completed']), configuration_hash: hash, snapshot: z.union([snapshot, z.object({ policies: z.tuple([]) }).strict()]),
}).strict().refine(value => value.sequence === value.tick + 1 && (value.status === 'completed') === (value.tick === 120) && (value.snapshot.policies.length === 0) === (value.tick === -1));
const event = z.object({ round_id: uuid, sequence: nonnegative, tick,
  event_type: z.enum(['tick-committed', 'round-closed']), snapshot,
}).strict().refine(value => value.sequence === value.tick + 1 && (value.event_type === 'round-closed') === (value.tick === 120));
const eventPage = z.object({ high_water: nonnegative.refine(value => value <= 121), events: z.array(event).max(100) }).strict();
const ownerInput = { roundId: uuid, ownerId: uuid };
const fenceInput = { ...ownerInput, fence: nonnegative.refine(value => value > 0) };
const ttl = integer.refine(value => value >= 1 && value <= 60);
const createInput = z.object({ roundId: uuid, classification, policyIds, configurationHash: hash, scheduleHash: hash, recovery, published: z.boolean().default(false) }).strict();
const acquireInput = z.object({ ...ownerInput, ttlSeconds: ttl.default(30) }).strict();
const renewInput = z.object({ ...fenceInput, ttlSeconds: ttl.default(30) }).strict();
const releaseInput = z.object(fenceInput).strict();
const commitInput = z.object({ ...fenceInput, expectedSequence: nonnegative, tick, commitKey: uuid,
  snapshot, decisions: z.array(decision).max(4), recovery,
}).strict().refine(value => value.expectedSequence === value.tick).refine(value => {
  const ids = value.snapshot.policies.map(item => item.policy_id).sort();
  const decisions = value.decisions.map(item => item.policy_id).sort();
  return value.tick === 120 ? decisions.length === 0 : JSON.stringify(ids) === JSON.stringify(decisions);
});
export type LivePublicSnapshot = z.infer<typeof publicSnapshot>;
export type LiveEventPage = z.infer<typeof eventPage>;
export type LiveCommitInput = z.input<typeof commitInput>;
export type LiveCreateInput = z.input<typeof createInput>;
export type LiveLease = z.infer<typeof lease>;

export class LiveStoreError extends Error {
  constructor(readonly code: 'configuration' | 'input' | 'transport' | 'http' | 'response', readonly status: number | null = null) {
    super(`Live store ${code} failure`);
    this.name = 'LiveStoreError';
  }
}
function jsonSafe(value: unknown, depth = 0): void {
  if (depth > 32) throw new Error();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) return;
  if (Array.isArray(value)) { for (const item of value) jsonSafe(item, depth + 1); return; }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new Error();
    jsonSafe(descriptor.value, depth + 1);
  }
}
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, code: 'input' | 'response'): z.output<S> {
  try { jsonSafe(value); return schema.parse(value); } catch { throw new LiveStoreError(code); }
}

/** Server process only. Never import this module into a client component or expose this instance.
 * No dispatch retries: an uncertain commit must be recovered using its original idempotency key.
 */
export class LiveStore {
  readonly #url: string;
  readonly #key: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  constructor(input: { supabaseUrl: string; serviceRoleKey: string; fetch?: typeof fetch; timeoutMs?: number }) {
    try {
      if (!versions.node || typeof (globalThis as { window?: unknown }).window !== 'undefined') throw new Error();
      const url = new URL(input.supabaseUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error();
      if (typeof input.serviceRoleKey !== 'string' || !/^[\x21-\x7e]{16,4096}$/.test(input.serviceRoleKey)) throw new Error();
      const timeoutMs = input.timeoutMs ?? 10_000;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error();
      this.#url = `${url.origin}/rest/v1`;
      this.#key = input.serviceRoleKey;
      this.#fetch = input.fetch ?? fetch;
      this.#timeoutMs = timeoutMs;
    } catch { throw new LiveStoreError('configuration'); }
  }
  async createRound(input: LiveCreateInput): Promise<{ round_id: string; tick: -1; sequence: 0 }> {
    const value = parse(createInput, input, 'input');
    const result = await this.#request('/rpc/live_create_round', { p_round_id: value.roundId, p_classification: value.classification,
      p_policy_ids: value.policyIds, p_configuration_hash: value.configurationHash, p_schedule_hash: value.scheduleHash,
      p_recovery: value.recovery, p_published: value.published }, z.object({ round_id: uuid, tick: z.literal(-1), sequence: z.literal(0) }).strict());
    if (result.round_id !== value.roundId) throw new LiveStoreError('response');
    return result;
  }
  async acquireLease(input: z.input<typeof acquireInput>): Promise<LiveLease> {
    const value = parse(acquireInput, input, 'input');
    return this.#request('/rpc/live_acquire_lease', { p_round_id: value.roundId, p_owner_id: value.ownerId, p_ttl_seconds: value.ttlSeconds }, lease);
  }
  async renewLease(input: z.input<typeof renewInput>): Promise<LiveLease> {
    const value = parse(renewInput, input, 'input');
    const result = await this.#request('/rpc/live_renew_lease', { p_round_id: value.roundId, p_owner_id: value.ownerId, p_fence: value.fence, p_ttl_seconds: value.ttlSeconds }, lease);
    if (result.fence !== value.fence) throw new LiveStoreError('response');
    return result;
  }
  async releaseLease(input: z.input<typeof releaseInput>): Promise<boolean> {
    const value = parse(releaseInput, input, 'input');
    return this.#request('/rpc/live_release_lease', { p_round_id: value.roundId, p_owner_id: value.ownerId, p_fence: value.fence }, z.boolean());
  }
  async commitTick(input: LiveCommitInput): Promise<{ round_id: string; tick: number; sequence: number; replayed: boolean }> {
    const value = parse(commitInput, input, 'input');
    const result = await this.#request('/rpc/live_commit_tick', { p_round_id: value.roundId, p_owner_id: value.ownerId,
      p_fence: value.fence, p_expected_sequence: value.expectedSequence, p_tick: value.tick, p_commit_key: value.commitKey,
      p_snapshot: value.snapshot, p_decisions: value.decisions, p_recovery: value.recovery },
    z.object({ round_id: uuid, tick, sequence: nonnegative, replayed: z.boolean() }).strict());
    if (result.round_id !== value.roundId || result.tick !== value.tick || result.sequence !== value.expectedSequence + 1) throw new LiveStoreError('response');
    return result;
  }
  async getSnapshot(roundId: string): Promise<LivePublicSnapshot | null> {
    const id = parse(uuid, roundId, 'input');
    const result = await this.#request('/rpc/live_get_snapshot', { p_round_id: id }, publicSnapshot.nullable());
    if (result !== null && result.round_id !== id) throw new LiveStoreError('response');
    return result;
  }
  async getEvents(input: { roundId: string; afterSequence: number; limit?: number }): Promise<LiveEventPage> {
    const value = parse(z.object({ roundId: uuid, afterSequence: nonnegative.refine(n => n <= 121), limit: integer.refine(n => n >= 1 && n <= 100).default(100) }).strict(), input, 'input');
    const result = await this.#request('/rpc/live_get_events', { p_round_id: value.roundId, p_after_sequence: value.afterSequence, p_limit: value.limit }, eventPage);
    if (result.high_water < value.afterSequence || result.events.length !== Math.min(value.limit, Math.max(0, result.high_water - value.afterSequence)) || result.events.some((item, index) => item.round_id !== value.roundId || item.sequence !== value.afterSequence + index + 1 || item.sequence > result.high_water)) throw new LiveStoreError('response');
    return result;
  }
  /** Private worker recovery envelope; requires a current fence. Validate engine/contract semantics before restoration. */
  async getRecovery(input: z.input<typeof releaseInput>): Promise<{ schemaVersion: 'live-recovery-1'; round_id: string; tick: number; sequence: number; configuration_hash: string; schedule_hash: string; recovery: Record<string, unknown> }> {
    const value = parse(releaseInput, input, 'input');
    const result = await this.#request('/rpc/live_get_recovery', { p_round_id: value.roundId, p_owner_id: value.ownerId, p_fence: value.fence },
      z.object({ schemaVersion: z.literal('live-recovery-1'), round_id: uuid, tick: integer.refine(n => n >= -1 && n <= 120), sequence: nonnegative,
        configuration_hash: hash, schedule_hash: hash, recovery }).strict());
    if (result.round_id !== value.roundId || result.sequence !== result.tick + 1) throw new LiveStoreError('response');
    return result;
  }
  async #request<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    let serialized: string;
    try {
      serialized = JSON.stringify(body);
      if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BYTES) throw new Error();
    } catch { throw new LiveStoreError('input'); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(`${this.#url}${path}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { apikey: this.#key, Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: serialized,
      });
      if (!response.ok) { await response.body?.cancel(); throw new LiveStoreError('http', response.status); }
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new LiveStoreError('response');
      const size = response.headers.get('content-length');
      if (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_RESPONSE_BYTES)) throw new LiveStoreError('response');
      const reader = response.body?.getReader();
      if (!reader) throw new LiveStoreError('response');
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0, text = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new LiveStoreError('response');
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new LiveStoreError('response'); }
      return parse(schema, value, 'response');
    } catch (error) {
      if (error instanceof LiveStoreError) throw error;
      throw new LiveStoreError('transport');
    } finally { clearTimeout(timer); controller.abort(); }
  }
}
