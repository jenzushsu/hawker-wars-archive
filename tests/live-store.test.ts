import { describe, expect, it, vi } from 'vitest';
import { LiveStore, LiveStoreError, type LiveCommitInput } from '../packages/live/src/store.ts';

const roundId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const commitKey = '33333333-3333-4333-8333-333333333333';
const serviceRoleKey = 'fixture-private-service-key';
const hash = 'a'.repeat(64);
const projection = { policies: [{ policy_id: 'rules' as const, cash_cents: 20000, profit_cents: 0, utility_points: 0, served: 0, abandoned: 0 }] };
const commit: LiveCommitInput = { roundId, ownerId, fence: 1, expectedSequence: 0, tick: 0, commitKey, snapshot: projection,
  decisions: [{ policy_id: 'rules', action: 'WAIT', source: 'rules', fallback_reason: null }], recovery: { schemaVersion: 'recovery-1', privateFixture: true } };
const wireSnapshot = { schemaVersion: 'live-snapshot-1', round_id: roundId, classification: 'exhibition', tick: 0, sequence: 1, status: 'running', control_state: 'active' as const, control_revision: 0, configuration_hash: hash, snapshot: projection };
const wireEvent = { round_id: roundId, sequence: 1, tick: 0, event_type: 'tick-committed', snapshot: projection };
function mock(value: unknown, status = 200) {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }));
  return { store: new LiveStore({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey, fetch: transport }), transport };
}

 describe('server-only live store transport', () => {
  it('creates a round with strict private input and no client-side time authority', async () => {
    const { store, transport } = mock({ round_id: roundId, tick: -1, sequence: 0 });
    await expect(store.createRound({ roundId, classification: 'exhibition', policyIds: ['rules'], configurationHash: hash, scheduleHash: hash, recovery: { schemaVersion: 'recovery-1' } })).resolves.toEqual({ round_id: roundId, tick: -1, sequence: 0 });
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/live_create_round');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } });
    expect(JSON.parse(init!.body as string)).toEqual({ p_round_id: roundId, p_classification: 'exhibition', p_policy_ids: ['rules'], p_configuration_hash: hash, p_schedule_hash: hash, p_recovery: { schemaVersion: 'recovery-1' }, p_published: false });
    expect(JSON.stringify(store)).toBe('{}');
    expect(Object.keys(store)).toEqual([]);
  });
  it('canonicalizes UUID inputs before dispatch so successful database writes are not reported as failures', async () => {
    const uppercaseRound = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
    const uppercaseOwner = 'BCDEFABC-DEFA-4BCD-8EFA-BCDEFABCDEFA';
    const uppercaseKey = 'CDEFABCD-EFAB-4CDE-8FAB-CDEFABCDEFAB';
    const canonicalRound = uppercaseRound.toLowerCase();
    const created = mock({ round_id: canonicalRound, tick: -1, sequence: 0 });
    await expect(created.store.createRound({ roundId: uppercaseRound, classification: 'exhibition', policyIds: ['rules'], configurationHash: hash, scheduleHash: hash, recovery: { schemaVersion: 'recovery-1' } })).resolves.toMatchObject({ round_id: canonicalRound });
    expect(JSON.parse(created.transport.mock.calls[0]![1]!.body as string).p_round_id).toBe(canonicalRound);
    const committed = mock({ round_id: canonicalRound, tick: 0, sequence: 1, replayed: false });
    await expect(committed.store.commitTick({ ...commit, roundId: uppercaseRound, ownerId: uppercaseOwner, commitKey: uppercaseKey })).resolves.toMatchObject({ round_id: canonicalRound });
    expect(JSON.parse(committed.transport.mock.calls[0]![1]!.body as string)).toMatchObject({ p_round_id: canonicalRound, p_owner_id: uppercaseOwner.toLowerCase(), p_commit_key: uppercaseKey.toLowerCase() });
    await expect(mock({ ...wireSnapshot, round_id: uppercaseRound }).store.getSnapshot(uppercaseRound)).resolves.toMatchObject({ round_id: canonicalRound });
  });
  it('sends authenticated-service control commands once and correlates exact original receipts', async () => {
    const request = { roundId, requestId: commitKey, action: 'pause' as const, expectedRevision: 4, actorId: 'operator_fixture' };
    const receipt = { schemaVersion: 'live-control-1', round_id: roundId, request_id: commitKey, action: 'pause',
      control_state: 'paused', control_revision: 5, tick: 30, sequence: 31, replayed: true };
    const { store, transport } = mock(receipt);
    await expect(store.controlRound(request)).resolves.toEqual(receipt);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0]).toContain('/rpc/live_control_round');
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toEqual({ p_round_id: roundId, p_request_id: commitKey,
      p_action: 'pause', p_expected_revision: 4, p_actor_id: 'operator_fixture' });
    for (const patch of [{ round_id: ownerId }, { request_id: ownerId }, { action: 'stop' }, { control_state: 'active' },
      { control_revision: 6 }, { sequence: 30 }, { tick: 120, sequence: 121 }, { private_audit: 'secret' }]) {
      await expect(mock({ ...receipt, ...patch }).store.controlRound(request)).rejects.toMatchObject({ code: 'response' });
    }
    const uppercase = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
    const normalized = mock({ ...receipt, round_id: uppercase.toLowerCase(), request_id: uppercase.toLowerCase() });
    await normalized.store.controlRound({ ...request, roundId: uppercase, requestId: uppercase });
    expect(JSON.parse(normalized.transport.mock.calls[0]![1]!.body as string)).toMatchObject({ p_round_id: uppercase.toLowerCase(), p_request_id: uppercase.toLowerCase() });
  });
  it('rejects malformed operator control requests before dispatch and never retries an uncertain control', async () => {
    const request = { roundId, requestId: commitKey, action: 'pause' as const, expectedRevision: 0, actorId: 'operator_fixture' };
    const { store, transport } = mock(null);
    for (const patch of [{ actorId: '' }, { actorId: 'a'.repeat(129) }, { actorId: 'user@example.org' }, { action: 'restart' },
      { expectedRevision: -0 }, { expectedRevision: -1 }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { serverTime: 123 }, { requestId: 'invalid' }]) {
      await expect(store.controlRound({ ...request, ...patch } as never)).rejects.toMatchObject({ code: 'input' });
    }
    expect(transport).not.toHaveBeenCalled();
    transport.mockRejectedValueOnce(new Error('private-credential-canary'));
    await expect(store.controlRound(request)).rejects.toMatchObject({ code: 'transport', message: 'Live store transport failure' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('uses database-issued leases and rejects a changed fence on renewal', async () => {
    const { store, transport } = mock({ fence: 7, expires_at: '2026-10-23T12:00:30+00:00' });
    await expect(store.acquireLease({ roundId, ownerId })).resolves.toMatchObject({ fence: 7 });
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toEqual({ p_round_id: roundId, p_owner_id: ownerId, p_ttl_seconds: 30 });
    await expect(store.renewLease({ roundId, ownerId, fence: 6 })).rejects.toMatchObject({ code: 'response' });
    await expect(store.renewLease({ roundId, ownerId, fence: 7 })).resolves.toMatchObject({ fence: 7 });
    const release = mock(true); await expect(release.store.releaseLease({ roundId, ownerId, fence: 7 })).resolves.toBe(true);
  });
  it('commits once with the original idempotency key and accepts exact replay acknowledgements', async () => {
    const { store, transport } = mock({ round_id: roundId, tick: 0, sequence: 1, replayed: true });
    await expect(store.commitTick(commit)).resolves.toMatchObject({ sequence: 1, replayed: true });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toMatchObject({ p_commit_key: commitKey, p_fence: 1, p_expected_sequence: 0, p_tick: 0 });
    const wrong = mock({ round_id: roundId, tick: 0, sequence: 2, replayed: false });
    await expect(wrong.store.commitTick(commit)).rejects.toMatchObject({ code: 'response' });
  });
  it('rejects malformed public payloads, attribution and partial policy commits before network dispatch', async () => {
    const { store, transport } = mock(null);
    const changes = [
      { ...commit, expectedSequence: 1 },
      { ...commit, snapshot: { ...projection, providerPayload: 'secret' } },
      { ...commit, decisions: [] },
      { ...commit, decisions: [{ ...commit.decisions[0], source: 'model' }] },
      { ...commit, decisions: [{ ...commit.decisions[0], fallback_reason: 'timeout' }] },
      { ...commit, recovery: { schemaVersion: 'recovery-1', ignored: undefined } },
      { ...commit, recovery: { schemaVersion: 'recovery-1', price: NaN } },
      { ...commit, recovery: { schemaVersion: 'recovery-1', fractional: 0.5 } },
      { ...commit, extra: true },
    ];
    for (const value of changes) await expect(store.commitTick(value as LiveCommitInput)).rejects.toMatchObject({ code: 'input' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('reads only allowlisted public snapshots and rejects wrong-round or leaked fields', async () => {
    await expect(mock(wireSnapshot).store.getSnapshot(roundId)).resolves.toEqual(wireSnapshot);
    await expect(mock(null).store.getSnapshot(roundId)).resolves.toBeNull();
    await expect(mock({ ...wireSnapshot, tick: -1, sequence: 0, snapshot: { policies: [] } }).store.getSnapshot(roundId)).resolves.toMatchObject({ tick: -1 });
    for (const value of [{ ...wireSnapshot, recovery: { seed: 7 } }, { ...wireSnapshot, round_id: ownerId }, { ...wireSnapshot, status: 'completed' }, { ...wireSnapshot, snapshot: { policies: [] } }]) {
      await expect(mock(value).store.getSnapshot(roundId)).rejects.toMatchObject({ code: 'response' });
    }
  });
  it('bounds event pages and rejects gaps, reordered events, wrong rounds and impossible high water', async () => {
    await expect(mock({ high_water: 2, events: [wireEvent] }).store.getEvents({ roundId, afterSequence: 0, limit: 1 })).resolves.toMatchObject({ high_water: 2 });
    for (const value of [
      { high_water: 1, events: [wireEvent, wireEvent] },
      { high_water: 2, events: [{ ...wireEvent, tick: 1, sequence: 2 }] },
      { high_water: 1, events: [{ ...wireEvent, round_id: ownerId }] },
      { high_water: 0, events: [wireEvent] },
      { high_water: 122, events: [] },
      { high_water: 1, events: [] },
      { high_water: 1, events: [{ ...wireEvent, seed: 99 }] },
    ]) await expect(mock(value).store.getEvents({ roundId, afterSequence: 0, limit: 1 })).rejects.toMatchObject({ code: 'response' });
    await expect(mock({ high_water: 0, events: [] }).store.getEvents({ roundId, afterSequence: 1 })).rejects.toMatchObject({ code: 'response' });
    const { store, transport } = mock(null);
    await expect(store.getEvents({ roundId, afterSequence: 0, limit: 101 })).rejects.toMatchObject({ code: 'input' });
    await expect(store.acquireLease({ roundId, ownerId, ttlSeconds: 61 })).rejects.toMatchObject({ code: 'input' });
    await expect(store.createRound({ roundId, classification: 'exhibition', policyIds: ['jev'], configurationHash: hash, scheduleHash: hash, recovery: { schemaVersion: 'recovery-1' } })).rejects.toMatchObject({ code: 'input' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('keeps recovery reads separate and fenced, without claiming semantic engine recovery', async () => {
    const value = { schemaVersion: 'live-recovery-1', round_id: roundId, classification: 'exhibition', policy_ids: ['rules'], status: 'running', control_state: 'active' as const, control_revision: 0, tick: 0, sequence: 1, configuration_hash: hash, schedule_hash: hash, recovery: { schemaVersion: 'recovery-1', privateData: [1, 2] } };
    const { store, transport } = mock(value);
    await expect(store.getRecovery({ roundId, ownerId, fence: 8 })).resolves.toEqual(value);
    expect(transport.mock.calls[0]![0]).toContain('/rpc/live_get_recovery');
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toEqual({ p_round_id: roundId, p_owner_id: ownerId, p_fence: 8 });
  });
  it('reads service-only status without a lease and rejects incompatible metadata or private fields', async () => {
    const status = { schemaVersion: 'live-round-status-1', ready: false, round_id: roundId, classification: 'exhibition', policy_ids: ['rules'], status: 'completed', control_state: 'active' as const, control_revision: 0, tick: 120, sequence: 121, configuration_hash: hash, schedule_hash: hash };
    const { store, transport } = mock(status);
    await expect(store.getRoundStatus(roundId)).resolves.toEqual(status);
    expect(transport.mock.calls[0]![0]).toContain('/rpc/live_get_round_status');
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toEqual({ p_round_id: roundId });
    await expect(mock(null).store.getRoundStatus(roundId)).resolves.toBeNull();
    for (const value of [{ ...status, round_id: ownerId }, { ...status, status: 'running' }, { ...status, sequence: 120 }, { ...status, policy_ids: ['jev'] }, { ...status, recovery: { private: true } }, { ...status, schedule_hash: 'wrong' }, { ...status, ready: true }]) {
      await expect(mock(value).store.getRoundStatus(roundId)).rejects.toMatchObject({ code: 'response' });
    }
  });
  it('requires authoritative classification, policies and status on fenced recovery responses', async () => {
    const value = { schemaVersion: 'live-recovery-1', round_id: roundId, classification: 'exhibition', policy_ids: ['rules'], status: 'running', control_state: 'active' as const, control_revision: 0, tick: 0, sequence: 1, configuration_hash: hash, schedule_hash: hash, recovery: { schemaVersion: 'recovery-1' } };
    for (const changed of [{ ...value, classification: undefined }, { ...value, policy_ids: [] }, { ...value, policy_ids: ['rules', 'rules'] }, { ...value, status: 'completed' }, { ...value, sequence: 0 }, { ...value, round_id: ownerId }]) {
      await expect(mock(changed).store.getRecovery({ roundId, ownerId, fence: 1 })).rejects.toMatchObject({ code: 'response' });
    }
  });
  it('sanitizes HTTP and network errors without retrying or exposing remote diagnostics', async () => {
    const { store, transport } = mock({ error: `${serviceRoleKey} secret provider payload` }, 403);
    const error = await store.commitTick(commit).catch(e => e);
    expect(error).toBeInstanceOf(LiveStoreError);
    expect(error).toMatchObject({ code: 'http', status: 403, message: 'Live store http failure' });
    expect(JSON.stringify(error)).not.toContain(serviceRoleKey);
    expect(transport).toHaveBeenCalledTimes(1);
    const failure = vi.fn<typeof fetch>().mockRejectedValue(new Error(serviceRoleKey));
    const broken = new LiveStore({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey, fetch: failure });
    await expect(broken.commitTick(commit)).rejects.toMatchObject({ code: 'transport', message: 'Live store transport failure' });
    expect(failure).toHaveBeenCalledTimes(1);
  });
  it('rejects unsafe destinations, credentials and browser construction', () => {
    for (const supabaseUrl of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?key=secret', 'https://example.com/#fragment']) {
      expect(() => new LiveStore({ supabaseUrl, serviceRoleKey })).toThrow('configuration');
    }
    expect(() => new LiveStore({ supabaseUrl: 'https://example.com', serviceRoleKey: 'bad\nkey' })).toThrow('configuration');
    vi.stubGlobal('window', {});
    try { expect(() => new LiveStore({ supabaseUrl: 'https://example.com', serviceRoleKey })).toThrow('configuration'); }
    finally { vi.unstubAllGlobals(); }
  });
  it('aborts timed-out requests without retrying', async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error(serviceRoleKey)), { once: true })));
    const store = new LiveStore({ supabaseUrl: 'https://example.com', serviceRoleKey, fetch: transport, timeoutMs: 5 });
    await expect(store.getSnapshot(roundId)).rejects.toMatchObject({ code: 'transport' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized requests, malformed JSON and bounded-response violations', async () => {
    const { store, transport } = mock(null);
    await expect(store.commitTick({ ...commit, recovery: { schemaVersion: 'recovery-1', padding: 'x'.repeat(1_048_576) } })).rejects.toMatchObject({ code: 'input' });
    expect(transport).not.toHaveBeenCalled();
    const responses = [
      () => new Response('{', { headers: { 'content-type': 'application/json' } }),
      () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
      () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '2097153' } }),
      () => new Response(' '.repeat(2_097_153), { headers: { 'content-type': 'application/json' } }),
    ];
    for (const response of responses) {
      const bounded = new LiveStore({ supabaseUrl: 'https://example.com', serviceRoleKey, fetch: vi.fn<typeof fetch>().mockImplementation(async () => response()) });
      await expect(bounded.getSnapshot(roundId)).rejects.toMatchObject({ code: 'response' });
    }
  });
});
