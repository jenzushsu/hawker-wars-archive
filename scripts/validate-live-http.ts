import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { LiveStore } from '../packages/live/src/store.ts';

const secret = process.env.P5_HTTP_JWT_SECRET;
if (!secret || secret.length < 32) throw new Error('Missing disposable gateway JWT secret');
const origin = 'http://127.0.0.1:3100';
const roundId = '11111111-1111-4111-8111-111111111111';
const hiddenId = '99999999-9999-4999-8999-999999999999';
const ownerId = '22222222-2222-4222-8222-222222222222';
const hash = 'a'.repeat(64);
function token(role: string): string {
  const data = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url')].join('.');
  return `${data}.${createHmac('sha256', secret!).update(data).digest('base64url')}`;
}
const tokens = { anon: token('anon'), authenticated: token('authenticated'), service_role: token('service_role') };
async function request(path: string, role: keyof typeof tokens, method = 'GET', body?: unknown) {
  return fetch(`${origin}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
// Test-only transport mapping: exercise the unchanged HTTPS-only client against local HTTP.
// PostgREST directly serves /rpc; Supabase's gateway normally supplies /rest/v1.
const localFetch: typeof fetch = (input, init) => {
  assert.equal(typeof input, 'string');
  const url = new URL(input as string);
  assert.equal(url.origin, 'https://gateway-test.invalid');
  assert.ok(url.pathname.startsWith('/rest/v1/'));
  return fetch(`${origin}${url.pathname.slice('/rest/v1'.length)}`, init);
};
let ready = false;
for (let attempt = 0; attempt < 100; attempt++) {
  try { const response = await request('/rpc/live_get_snapshot', 'anon', 'POST', { p_round_id: roundId }); if (response.ok) { ready = true; break; } } catch { /* bounded startup wait */ }
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert.ok(ready, 'Local PostgREST must become ready');
const store = new LiveStore({ supabaseUrl: 'https://gateway-test.invalid', serviceRoleKey: tokens.service_role, fetch: localFetch });
const recovery = { schemaVersion: 'recovery-1', marker: 'private-http-canary', privateSeed: 7 };
await store.createRound({ roundId, classification: 'exhibition', policyIds: ['rules'], configurationHash: hash, scheduleHash: hash, recovery, published: true });
const lease = await store.acquireLease({ roundId, ownerId, ttlSeconds: 60 });
assert.equal(lease.fence, 1);
const snapshot = { policies: [{ policy_id: 'rules' as const, cash_cents: 20000, profit_cents: 0, utility_points: 0, served: 0, abandoned: 0 }] };
const commit = { roundId, ownerId, fence: lease.fence, expectedSequence: 0, tick: 0, commitKey: '33333333-3333-4333-8333-333333333333', snapshot,
  decisions: [{ policy_id: 'rules' as const, action: 'WAIT' as const, source: 'rules' as const, fallback_reason: null }], recovery };
assert.equal((await store.commitTick(commit)).replayed, false);
assert.equal((await store.commitTick(commit)).replayed, true);
await assert.rejects(store.commitTick({ ...commit, recovery: { ...recovery, changed: true } }), { code: 'http' });
await assert.rejects(store.commitTick({ ...commit, ownerId: '44444444-4444-4444-8444-444444444444' }), { code: 'http' });
assert.equal((await store.getRecovery({ roundId, ownerId, fence: lease.fence })).recovery.marker, recovery.marker);
assert.equal((await store.getSnapshot(roundId))?.sequence, 1);
assert.equal((await store.getEvents({ roundId, afterSequence: 0 })).events.length, 1);
for (const role of ['anon', 'authenticated'] as const) {
  const visible = await request('/rounds?select=id', role);
  assert.equal(visible.status, 200);
  assert.deepEqual(await visible.json(), [{ id: roundId }]);
  const hidden = await request('/rpc/live_get_snapshot', role, 'POST', { p_round_id: hiddenId });
  assert.equal(hidden.status, 200); assert.equal(await hidden.json(), null);
  const publicSnapshot = await request('/rpc/live_get_snapshot', role, 'POST', { p_round_id: roundId });
  assert.equal(publicSnapshot.status, 200);
  const publicText = await publicSnapshot.text();
  assert.ok(!publicText.includes('private-http-canary'));
  const events = await request('/rpc/live_get_events', role, 'POST', { p_round_id: roundId, p_after_sequence: 0, p_limit: 100 });
  assert.equal(events.status, 200); assert.equal((await events.json()).events.length, 1);
  for (const table of ['rounds', 'game_events', 'decisions', 'stall_snapshots']) {
    const denied = await request(`/${table}`, role, 'DELETE');
    assert.equal(denied.status, role === 'anon' ? 401 : 403, `${role} cannot delete ${table}`);
    assert.equal((await denied.json()).code, '42501');
  }
  for (const [path, body] of [
    ['/rpc/live_acquire_lease', { p_round_id: roundId, p_owner_id: ownerId, p_ttl_seconds: 30 }],
    ['/rpc/live_get_recovery', { p_round_id: roundId, p_owner_id: ownerId, p_fence: lease.fence }],
  ] as const) {
    const denied = await request(path, role, 'POST', body);
    assert.equal(denied.status, role === 'anon' ? 401 : 403, `${role} denied private worker RPC`);
    assert.equal((await denied.json()).code, '42501');
  }
}
const directWrite = await request(`/rounds?id=eq.${roundId}`, 'service_role', 'PATCH', { tick: 100 });
assert.equal(directWrite.status, 403, 'Service role must use commit RPC');
const invalid = await request('/rpc/live_commit_tick', 'service_role', 'POST', {
  p_round_id: roundId, p_owner_id: ownerId, p_fence: lease.fence, p_expected_sequence: 1, p_tick: 1,
  p_commit_key: '55555555-5555-4555-8555-555555555555', p_snapshot: { ...snapshot, secret: 'must-not-publish' },
  p_decisions: commit.decisions, p_recovery: recovery,
});
assert.equal(invalid.status, 400);
assert.equal((await store.getSnapshot(roundId))?.sequence, 1);
assert.equal((await store.getEvents({ roundId, afterSequence: 0 })).events.length, 1);
assert.equal(await store.releaseLease({ roundId, ownerId, fence: lease.fence }), true);
console.log('Local PostgREST HTTP integration passed: real client RPCs, JWT roles, RLS reads, denied writes/private RPCs, idempotency and rollback. No Supabase Realtime/hosted deployment claim.');
