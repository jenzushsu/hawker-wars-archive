import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { LiveStore } from '../packages/live/src/store.ts';
import { handleViewRequest } from '../packages/live/src/view-gateway.ts';
import { createRulesRoundInput, runRulesTick } from '../packages/live/src/worker.ts';

const secret = process.env.P5_HTTP_JWT_SECRET;
if (!secret || secret.length < 32) throw new Error('Missing disposable gateway secret');
const origin = 'http://127.0.0.1:3103';
const roundId = '11111111-1111-4111-8111-111111111111';
const hiddenId = '99999999-9999-4999-8999-999999999999';
function token(role: string): string {
  const payload = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url')].join('.');
  return `${payload}.${createHmac('sha256', secret!).update(payload).digest('base64url')}`;
}
const tokens = { anon: token('anon'), authenticated: token('authenticated'), service_role: token('service_role') };
async function request(path: string, role: keyof typeof tokens, method = 'GET', body?: unknown) {
  return fetch(`${origin}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const localFetch: typeof fetch = (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://view-test.invalid');
  assert.ok(url.pathname.startsWith('/rest/v1/'));
  return fetch(`${origin}${url.pathname.slice('/rest/v1'.length)}`, init);
};
const store = new LiveStore({ supabaseUrl: 'https://view-test.invalid', serviceRoleKey: tokens.service_role, fetch: localFetch });
const readerPaths: string[] = [];
const readerFetch: typeof fetch = (input, init) => { readerPaths.push(new URL(String(input)).pathname); return localFetch(input, init); };
const reader = new LiveStore({ supabaseUrl: 'https://view-test.invalid', serviceRoleKey: tokens.service_role, fetch: readerFetch });
let ready = false;
for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await request('/rpc/live_get_view', 'anon', 'POST', { p_round_id: roundId })).ok) { ready = true; break; } } catch { /* bounded gateway startup */ }
  await delay(100);
}
assert.ok(ready, 'Local viewer gateway is ready');

async function view(round: string, afterSequence = 0, limit = 100) {
  const response = await handleViewRequest(new Request(`https://app.example/api/live/rounds/${round}?after=${afterSequence}&limit=${limit}`),
    { roundId: round, store: () => reader });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const value = await reader.getView({ roundId: round, afterSequence, limit });
  assert.ok(value);
  // A second read can be newer during a concurrent commit; each is independently coherent.
  const wire = await response.json();
  assert.equal(wire.snapshot.sequence, wire.events.high_water);
  assert.equal(value.snapshot.sequence, value.events.high_water);
  assert.deepEqual(wire.events.events.map((event: { sequence: number }) => event.sequence),
    Array.from({ length: Math.min(limit, wire.events.high_water - afterSequence) }, (_, index) => afterSequence + index + 1));
  assert.ok(!JSON.stringify(wire).match(/privateToPublicIds|schedule_hash|scheduleHash|workerVersion|session_id|draw_digest|draw_r|owner_id|expires_at|recovery/));
  return value;
}
let invalidCalls = 0;
for (const suffix of ['?after=-1', '?after=122', '?limit=101', '?after=0&after=1', '?secret=1']) {
  const response = await handleViewRequest(new Request(`https://app.example/api/live/rounds/${roundId}${suffix}`),
    { roundId, store: () => { invalidCalls++; return reader; } });
  assert.equal(response.status, 400);
}
assert.equal(invalidCalls, 0, 'Invalid cursors cannot reach storage');
for (const id of [hiddenId, randomUUID()]) {
  assert.equal(await store.getView({ roundId: id, afterSequence: 0 }), null);
  assert.equal((await handleViewRequest(new Request('https://app.example/api/live/rounds/hidden'), { roundId: id, store: () => reader })).status, 404);
}
for (const role of ['anon', 'authenticated'] as const) {
  const hidden = await request('/rpc/live_get_view', role, 'POST', { p_round_id: hiddenId });
  assert.equal(hidden.status, 200); assert.equal(await hidden.json(), null);
  for (const rpc of ['live_acquire_lease', 'live_get_recovery']) {
    const body = rpc === 'live_acquire_lease' ? { p_round_id: roundId, p_owner_id: randomUUID(), p_ttl_seconds: 30 }
      : { p_round_id: roundId, p_owner_id: randomUUID(), p_fence: 1 };
    const denied = await request(`/rpc/${rpc}`, role, 'POST', body);
    assert.equal(denied.status, role === 'anon' ? 401 : 403);
    assert.equal((await denied.json()).code, '42501');
  }
  const denied = await request('/rounds', role, 'PATCH', { tick: 100 });
  assert.equal(denied.status, role === 'anon' ? 401 : 403);
}

await store.createRound(createRulesRoundInput(roundId, 7, true));
const initial = await view(roundId);
assert.equal(initial.snapshot.tick, -1);
assert.equal(initial.vote_window, null); assert.equal(initial.vote_result, null);
const future = await handleViewRequest(new Request('https://app.example/live?after=1'), { roundId, store: () => reader });
assert.equal(future.status, 409);
assert.deepEqual(await future.json(), { error: 'view-cursor-conflict' });
let cursorA = 0, cursorB = 0;
const seenA: number[] = [], seenB: number[] = [];
for (let tick = 0; tick <= 120; tick++) {
  const [commit, a, b] = await Promise.all([
    runRulesTick(store, { roundId, ownerId: randomUUID() }),
    view(roundId, cursorA, 7), view(roundId, cursorB, 3),
  ]);
  assert.equal(commit.tick, tick);
  for (const [result, seen] of [[a, seenA], [b, seenB]] as const) {
    seen.push(...result.events.events.map(event => event.sequence));
  }
  cursorA = a.events.events.at(-1)?.sequence ?? cursorA;
  cursorB = b.events.events.at(-1)?.sequence ?? cursorB;
  if (tick === 5) {
    await store.controlRound({ roundId, requestId: randomUUID(), action: 'pause', expectedRevision: 0, actorId: 'viewer-http-test' });
    const paused = await view(roundId, 6);
    assert.equal(paused.snapshot.tick, 5); assert.equal(paused.snapshot.control_state, 'paused');
    assert.equal(paused.snapshot.control_revision, 1); assert.equal(paused.events.events.length, 0);
    assert.equal((await runRulesTick(store, { roundId, ownerId: randomUUID() })).status, 'paused');
    await store.controlRound({ roundId, requestId: randomUUID(), action: 'resume', expectedRevision: 1, actorId: 'viewer-http-test' });
    const resumed = await view(roundId, 6);
    assert.equal(resumed.snapshot.sequence, 6); assert.equal(resumed.snapshot.control_revision, 2);
    assert.equal(resumed.snapshot.control_state, 'active');
  }
}
for (const [cursor, seen] of [[cursorA, seenA], [cursorB, seenB]] as const) {
  const final = await view(roundId, cursor);
  seen.push(...final.events.events.map(event => event.sequence));
  assert.deepEqual(seen, Array.from({ length: 121 }, (_, index) => index + 1));
  assert.equal(final.snapshot.status, 'completed');
}
const delayed = await view(roundId, 0, 100);
assert.equal(delayed.snapshot.sequence, 121); assert.equal(delayed.events.events.length, 100);
const catchup = await view(roundId, 100, 100);
assert.equal(catchup.events.events.length, 21);
assert.equal(catchup.events.events.at(-1)?.event_type, 'round-closed');
const publicView = await request('/rpc/live_get_view', 'anon', 'POST', { p_round_id: roundId, p_after_sequence: 120 });
assert.equal(publicView.status, 200); assert.equal((await publicView.json()).snapshot.sequence, 121);
const decisions = await request(`/decisions?round_id=eq.${roundId}&select=tick`, 'anon');
assert.equal(decisions.status, 200); assert.equal((await decisions.json()).length, 120, 'Many spectator reads cannot cause extra decisions');
assert.ok(readerPaths.length > 240);
assert.ok(readerPaths.every(path => path === '/rest/v1/rpc/live_get_view'), 'Viewer reads cannot invoke a worker, lease or provider operation');

const stoppedId = randomUUID();
await store.createRound(createRulesRoundInput(stoppedId, 8, true));
await runRulesTick(store, { roundId: stoppedId, ownerId: randomUUID() });
await store.controlRound({ roundId: stoppedId, requestId: randomUUID(), action: 'stop', expectedRevision: 0, actorId: 'viewer-http-test' });
const stopped = await view(stoppedId, 1);
assert.equal(stopped.snapshot.control_state, 'stopped'); assert.equal(stopped.snapshot.sequence, 1);
assert.equal(stopped.events.events.length, 0);
console.log('Local shared-view HTTP validation passed: coherent concurrent readers/worker, complete cursor catchup, control-only updates, read-only permissions and no extra decisions. Test-only pacing override; no hosted or Realtime claim.');

// Real local PostgREST and PostgreSQL with explicitly mocked provider controllers.
// No provider transport or credential is used by this integration fixture.
const { createMultiRoundInput, runMultiTick } = await import('../packages/live/src/multi-worker.ts');
const { chooseRules } = await import('../packages/decisions/src/rules.ts');
const multiId = randomUUID(), providerConfigurationHash = 'a'.repeat(64);
assert.equal(await store.getMultiWorkerProtocol(), 'multi-policy-worker-1');
await store.createRound(createMultiRoundInput(multiId, 7, providerConfigurationHash, true));
let providerCalls = 0;
const controller = (provider: 'jev' | 'zoom' | 'zoom-pro') => ({ async decideTurn(input: import('../packages/shared/src/schemas.ts').DecisionInput): Promise<import('../packages/providers/src/adapter.ts').LiveTurn> {
  providerCalls++;
  return { mode: 'live', origin: 'provider', attemptedProvider: provider, attemptCount: 1, diagnostic: 'local-test-only',
    result: { provider, action: provider === 'jev' ? 'WAIT' : chooseRules(input.observation, input.legalActions).action, status: 'success', latencyMs: 0 } };
} });
const controllers = { jev: controller('jev'), zoom: controller('zoom'), 'zoom-pro': controller('zoom-pro') };
for (let tick = 0; tick < 8; tick++) {
  // A fresh client/owner exercises persisted recovery at every boundary.
  const fresh = new LiveStore({ supabaseUrl: 'https://view-test.invalid', serviceRoleKey: tokens.service_role, fetch: localFetch });
  assert.equal((await runMultiTick(fresh, { roundId: multiId, ownerId: randomUUID(), providerConfigurationHash }, controllers)).tick, tick);
  const calls = providerCalls;
  const [a,b] = await Promise.all([view(multiId), view(multiId)]);
  assert.deepEqual(a.snapshot, b.snapshot); assert.equal(a.snapshot.snapshot.policies.length, 4);
  assert.equal(providerCalls, calls, 'Viewer reads cannot dispatch providers');
}
const multiView = await view(multiId);
assert.notDeepEqual(multiView.snapshot.snapshot.policies[0]!.served, multiView.snapshot.snapshot.policies[1]!.served, 'Independent choices create independent stall outcomes');
await store.controlRound({ roundId: multiId, requestId: randomUUID(), action: 'pause', expectedRevision: 0, actorId: 'multi-http-test' });
const before = providerCalls;
assert.equal((await runMultiTick(store, { roundId: multiId, ownerId: randomUUID(), providerConfigurationHash }, controllers)).status, 'paused');
assert.equal(providerCalls, before);
await store.controlRound({ roundId: multiId, requestId: randomUUID(), action: 'stop', expectedRevision: 1, actorId: 'multi-http-test' });
assert.equal((await view(multiId)).snapshot.control_state, 'stopped');
console.log('Local multi-policy HTTP integration passed: four atomic stall states, independent decisions, persisted recovery, read-only viewers and durable controls. Mock controllers; zero remote provider requests.');
