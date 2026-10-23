import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { LiveStore } from '../packages/live/src/store.ts';
import { handleOperatorRequest } from '../packages/live/src/operator.ts';
import { createRulesRoundInput, runRulesTick } from '../packages/live/src/worker.ts';
import { setTimeout as delay } from 'node:timers/promises';

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
    ['/rpc/live_get_round_status', { p_round_id: roundId }],
    ['/rpc/live_control_round', { p_round_id: roundId, p_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', p_action: 'pause', p_expected_revision: 0, p_actor_id: 'operator-http-test' }],
  ] as const) {
    const denied = await request(path, role, 'POST', body);
    assert.equal(denied.status, role === 'anon' ? 401 : 403, `${role} denied private worker RPC`);
    assert.equal((await denied.json()).code, '42501');
  }
}
await assert.rejects(store.controlRound({ roundId, requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', action: 'pause', expectedRevision: 0, actorId: 'operator-http-test' }), { code: 'http', status: 409 }, 'Generic recovery fixture cannot be operated as a rules worker');
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
// Finish the synthetic storage fixture so the one-running-round constraint permits
// a separate real rules-worker round. This fixture has no worker pacing marker.
const finishingLease = await store.acquireLease({ roundId, ownerId, ttlSeconds: 60 });
for (let tick = 1; tick <= 120; tick++) {
  await store.commitTick({ ...commit, fence: finishingLease.fence, tick, expectedSequence: tick,
    commitKey: `00000000-0000-4000-8000-${String(tick + 100).padStart(12, '0')}`,
    decisions: tick === 120 ? [] : commit.decisions });
}
assert.equal((await store.getRoundStatus(roundId))?.status, 'completed');
await store.releaseLease({ roundId, ownerId, fence: finishingLease.fence });

const workerRound = '66666666-6666-4666-8666-666666666666';
await store.createRound(createRulesRoundInput(workerRound, 7, true));
assert.deepEqual(await runRulesTick(store, { roundId: workerRound, ownerId }),
  { status: 'committed', tick: 0, sequence: 1, replayed: false });
assert.equal((await runRulesTick(store, { roundId: workerRound, ownerId })).status, 'waiting');
assert.equal((await store.getEvents({ roundId: workerRound, afterSequence: 0 })).events.length, 1);
await delay(5100);
let commitRequests = 0;
const lostAckFetch: typeof fetch = async (input, init) => {
  const response = await localFetch(input, init);
  if (String(input).endsWith('/rpc/live_commit_tick')) {
    commitRequests++;
    assert.equal(response.status, 200, 'Commit must succeed before simulating a lost acknowledgement');
    await response.arrayBuffer();
    throw new Error('Synthetic lost acknowledgement');
  }
  return response;
};
const interrupted = new LiveStore({ supabaseUrl: 'https://gateway-test.invalid', serviceRoleKey: tokens.service_role, fetch: lostAckFetch });
await assert.rejects(runRulesTick(interrupted, { roundId: workerRound, ownerId }), { code: 'store' });
assert.equal(commitRequests, 1, 'Uncertain commit must not retry within the invocation');
assert.equal((await store.getSnapshot(workerRound))?.sequence, 2);
await delay(5100);
const restarted = new LiveStore({ supabaseUrl: 'https://gateway-test.invalid', serviceRoleKey: tokens.service_role, fetch: localFetch });
assert.deepEqual(await runRulesTick(restarted, { roundId: workerRound, ownerId: '77777777-7777-4777-8777-777777777777' }),
  { status: 'committed', tick: 2, sequence: 3, replayed: false });
const workerEvents = await store.getEvents({ roundId: workerRound, afterSequence: 0 });
assert.deepEqual(workerEvents.events.map(event => event.sequence), [1, 2, 3]);
assert.ok(!JSON.stringify(workerEvents).match(/privateSeed|recentActions|workerVersion|schedule|stateHash/));
// Durable controls serialize against the same committed boundary as worker writes.
const controlOwner = '88888888-8888-4888-8888-888888888888';
const staleLease = await store.acquireLease({ roundId: workerRound, ownerId: controlOwner, ttlSeconds: 60 });
const pause = { roundId: workerRound, requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', action: 'pause' as const, expectedRevision: 0, actorId: 'operator-http-test' };
const operatorToken = 'http-test-operator-token-never-used-outside-local-tests';
const operatorRequest = (body: unknown) => new Request('https://operator-test.invalid/api/admin/rounds/control', {
  method: 'POST', headers: { authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const { actorId: _actorId, ...pauseBody } = pause;
const pauseResponse = await handleOperatorRequest(operatorRequest(pauseBody), { token: operatorToken, actorId: pause.actorId, store: () => store });
assert.equal(pauseResponse.status, 200, 'Authenticated handler must reach the durable control transaction');
assert.equal(pauseResponse.headers.get('cache-control'), 'no-store');
const paused = await pauseResponse.json();
const statusResponse = await handleOperatorRequest(operatorRequest({ action: 'status', roundId: workerRound }), { token: operatorToken, actorId: pause.actorId, store: () => store });
assert.equal(statusResponse.status, 200);
assert.equal((await statusResponse.json()).control_state, 'paused');
assert.deepEqual(paused, { schemaVersion: 'live-control-1', round_id: workerRound, request_id: pause.requestId,
  action: 'pause', control_state: 'paused', control_revision: 1, tick: 2, sequence: 3, replayed: false });
assert.equal((await store.getRoundStatus(workerRound))?.ready, false);
assert.equal((await runRulesTick(store, { roundId: workerRound, ownerId })).status, 'paused');
await assert.rejects(store.acquireLease({ roundId: workerRound, ownerId }), { code: 'http' });
await assert.rejects(store.renewLease({ roundId: workerRound, ownerId: controlOwner, fence: staleLease.fence }), { code: 'http' });
await assert.rejects(store.commitTick({ ...commit, roundId: workerRound, ownerId: controlOwner, fence: staleLease.fence,
  expectedSequence: 3, tick: 3, commitKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }), { code: 'http' });
assert.equal((await store.getSnapshot(workerRound))?.sequence, 3, 'Pause cannot create a fake tick');
await assert.rejects(store.controlRound({ ...pause, action: 'resume' }), { code: 'http', status: 409 }, 'Request reuse with another action conflicts');
const conflictResponse = await handleOperatorRequest(operatorRequest({ ...pauseBody, action: 'resume' }), { token: operatorToken, actorId: pause.actorId, store: () => store });
assert.equal(conflictResponse.status, 409, 'Known durable control conflicts must remain HTTP 409 through the operator endpoint');
assert.deepEqual(await conflictResponse.json(), { error: 'control-conflict' });
assert.deepEqual(await store.controlRound(pause), { ...paused, replayed: true });
const resume = { ...pause, requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', action: 'resume' as const, expectedRevision: 1 };
assert.equal((await store.controlRound(resume)).control_revision, 2);
assert.equal((await store.getSnapshot(workerRound))?.control_state, 'active');
assert.deepEqual(await store.controlRound(pause), { ...paused, replayed: true }, 'Old accepted retry returns original receipt');
assert.equal((await store.getRoundStatus(workerRound))?.control_state, 'active', 'Old pause retry cannot undo resume');
await assert.rejects(store.controlRound({ ...pause, requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }), { code: 'http', status: 409 }, 'Stale revision cannot control current state');
await assert.rejects(store.renewLease({ roundId: workerRound, ownerId: controlOwner, fence: staleLease.fence }), { code: 'http' }, 'Resume cannot revive a revoked lease');
const freshLease = await store.acquireLease({ roundId: workerRound, ownerId: controlOwner });
assert.ok(freshLease.fence > staleLease.fence);
await store.releaseLease({ roundId: workerRound, ownerId: controlOwner, fence: freshLease.fence });

const stop = { ...pause, requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', action: 'stop' as const, expectedRevision: 2 };
let controlRequests = 0;
const lostControlAck: typeof fetch = async (input, init) => {
  const response = await localFetch(input, init);
  if (String(input).endsWith('/rpc/live_control_round')) {
    controlRequests++;
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    throw new Error('Synthetic lost control acknowledgement');
  }
  return response;
};
const uncertainControl = new LiveStore({ supabaseUrl: 'https://gateway-test.invalid', serviceRoleKey: tokens.service_role, fetch: lostControlAck });
await assert.rejects(uncertainControl.controlRound(stop), { code: 'transport' });
assert.equal(controlRequests, 1, 'Control client cannot blindly retry an uncertain request');
const stopped = await store.controlRound(stop);
assert.equal(stopped.replayed, true);
assert.equal(stopped.control_state, 'stopped');
assert.equal(stopped.control_revision, 3);
assert.equal((await runRulesTick(store, { roundId: workerRound, ownerId })).status, 'stopped');
await assert.rejects(store.acquireLease({ roundId: workerRound, ownerId }), { code: 'http' });
await assert.rejects(store.controlRound({ ...resume, requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', expectedRevision: 3 }), { code: 'http', status: 409 }, 'Stop is irreversible');
assert.deepEqual((await store.getEvents({ roundId: workerRound, afterSequence: 0 })).events.map(event => event.sequence), [1, 2, 3]);
for (const role of ['anon', 'authenticated'] as const) {
  const response = await request('/rpc/live_get_snapshot', role, 'POST', { p_round_id: workerRound });
  assert.equal(response.status, 200);
  const publicControl = await response.json();
  assert.equal(publicControl.control_state, 'stopped');
  assert.equal(publicControl.control_revision, 3);
  assert.ok(!JSON.stringify(publicControl).match(/operator-http-test|actor_id|request_id|recovery|owner_id|expires_at/), 'Public control projection cannot reveal private audit or lease data');
}
const replacementRound = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
await store.createRound(createRulesRoundInput(replacementRound, 8));
assert.equal((await store.getRoundStatus(replacementRound))?.tick, -1, 'A stopped round releases the one-active-round slot');
console.log('Local PostgREST integration passed: permissions, fenced commits, real rules ticks, pacing, restart after lost acknowledgements, durable pause/resume/stop and control idempotency. No hosted deployment/Realtime claim.');
