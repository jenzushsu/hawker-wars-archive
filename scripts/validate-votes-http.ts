import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { LiveStore, LiveStoreError } from '../packages/live/src/store.ts';
import { handleVoteRequest } from '../packages/live/src/vote-gateway.ts';

const secret = process.env.P5_HTTP_JWT_SECRET;
if (!secret || secret.length < 32) throw new Error('Missing disposable gateway secret');
const origin = 'http://127.0.0.1:3100';
const roundId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
function token(role: string): string {
  const payload = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url')].join('.');
  return `${payload}.${createHmac('sha256', secret!).update(payload).digest('base64url')}`;
}
const tokens = { anon: token('anon'), authenticated: token('authenticated'), service_role: token('service_role') };
async function rpc(name: string, role: keyof typeof tokens, body: unknown) {
  return fetch(`${origin}/rpc/${name}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
const localFetch: typeof fetch = (input, init) => {
  assert.equal(typeof input, 'string');
  const url = new URL(input as string);
  assert.equal(url.origin, 'https://votes-test.invalid');
  assert.ok(url.pathname.startsWith('/rest/v1/'));
  return fetch(`${origin}${url.pathname.slice('/rest/v1'.length)}`, init);
};
let ready = false;
for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await rpc('live_get_vote_window', 'anon', { p_round_id: roundId })).ok) { ready = true; break; } } catch { /* bounded startup */ }
  await delay(100);
}
assert.ok(ready, 'Local PostgREST must become ready');
const store = new LiveStore({ supabaseUrl: 'https://votes-test.invalid', serviceRoleKey: tokens.service_role, fetch: localFetch });
assert.equal(await store.getVoteWindow(roundId), null);
for (const role of ['anon', 'authenticated'] as const) {
  for (const [name, body] of [
    ['live_open_vote_window', { p_round_id: roundId, p_owner_id: ownerId, p_fence: 1 }],
    ['live_submit_vote', { p_round_id: roundId, p_session_id: ownerId, p_request_id: randomUUID(), p_option_id: 'bus' }],
    ['live_get_vote_receipt', { p_round_id: roundId, p_session_id: ownerId }],
  ] as const) {
    const denied = await rpc(name, role, body);
    assert.equal(denied.status, role === 'anon' ? 401 : 403);
    assert.equal((await denied.json()).code, '42501');
  }
  for (const table of ['vote_windows', 'audience_votes', 'vote_receipts']) {
    const denied = await fetch(`${origin}/${table}`, { headers: { Authorization: `Bearer ${tokens[role]}` } });
    assert.equal(denied.status, 404, 'Private vote tables are absent from exposed schema');
  }
}
const lease = await store.acquireLease({ roundId, ownerId, ttlSeconds: 60 });
const window = await store.openVoteWindow({ roundId, ownerId, fence: lease.fence });
assert.equal(window.status, 'open');
assert.ok(window.remaining_ms > 19000 && window.remaining_ms <= 20000);
assert.equal((await store.openVoteWindow({ roundId, ownerId, fence: lease.fence })).deadline_ms, window.deadline_ms, 'Reopening never extends deadline');
await assert.rejects(store.commitTick({ roundId, ownerId, fence: lease.fence, expectedSequence: 31, tick: 31,
  commitKey: randomUUID(), snapshot: { policies: [{ policy_id: 'rules', cash_cents: 20000, profit_cents: 0, utility_points: 0, served: 0, abandoned: 0 }] },
  decisions: [{ policy_id: 'rules', action: 'WAIT', source: 'rules', fallback_reason: null }],
  recovery: { schemaVersion: 'recovery-1', workerVersion: 'rules-worker-1', votingEnabled: true },
}), { code: 'http' }, 'Unintegrated votes must never be silently ignored by continued ticks');
assert.equal((await store.getRoundStatus(roundId))?.tick, 30);

const options = { signingKey: 'local-http-only-vote-signing-key-12345678901234567890', origin: 'https://app.example', store: () => store };
function browserRequest(body: unknown, cookie?: string): Request {
  return new Request(`${options.origin}/api/votes`, { method: 'POST', headers: { Origin: options.origin,
    'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
}
const minted = await handleVoteRequest(browserRequest({ action: 'session', roundId }), options);
assert.equal(minted.status, 200);
assert.equal(minted.headers.get('cache-control'), 'no-store');
const setCookie = minted.headers.get('set-cookie')!;
assert.match(setCookie, /HttpOnly; Secure; SameSite=Strict; Path=\//);
const cookie = setCookie.split(';')[0]!;
assert.ok(!JSON.stringify(await minted.json()).includes('sessionId'));
const first = { action: 'submit', roundId, requestId: randomUUID(), optionId: 'bus' };
const firstResponse = await handleVoteRequest(browserRequest(first, cookie), options);
assert.equal(firstResponse.status, 200);
const firstReceipt = (await firstResponse.json()).receipt;
const change = { ...first, requestId: randomUUID(), optionId: 'rain' };
assert.equal((await handleVoteRequest(browserRequest(change, cookie), options)).status, 200);
const retry = await handleVoteRequest(browserRequest(first, cookie), options);
assert.equal(retry.status, 200);
assert.deepEqual((await retry.json()).receipt, { ...firstReceipt, replayed: true });
const status = await handleVoteRequest(browserRequest({ action: 'status', roundId }, cookie), options);
assert.equal((await status.json()).receipt.option_id, 'rain', 'Retrying an older accepted request does not undo the new choice');
assert.equal((await handleVoteRequest(browserRequest({ ...first, optionId: 'rain' }, cookie), options)).status, 409);
assert.equal((await handleVoteRequest(browserRequest({ ...first, requestId: randomUUID() }, cookie), options)).status, 429, 'Per-session rate applies');
const otherMint = await handleVoteRequest(browserRequest({ action: 'session', roundId }), options);
const otherCookie = otherMint.headers.get('set-cookie')!.split(';')[0]!;
const otherStatus = await handleVoteRequest(browserRequest({ action: 'status', roundId }, otherCookie), options);
assert.equal((await otherStatus.json()).receipt, null, 'Another signed session cannot read the first receipt');
const pause = await store.controlRound({ roundId, requestId: randomUUID(), action: 'pause', expectedRevision: 0, actorId: 'votes-http-test' });
assert.equal(pause.control_state, 'paused');
const frozen = await store.getVoteWindow(roundId);
assert.ok(frozen?.paused && frozen.deadline_ms === null);
await delay(1100);
assert.equal((await store.getVoteWindow(roundId))?.remaining_ms, frozen.remaining_ms, 'Paused duration is durable');
assert.equal((await handleVoteRequest(browserRequest({ ...first, requestId: randomUUID() }, cookie), options)).status, 409);
assert.equal((await handleVoteRequest(browserRequest(first, cookie), options)).status, 200, 'Accepted retry remains available while paused');
await store.controlRound({ roundId, requestId: randomUUID(), action: 'resume', expectedRevision: 1, actorId: 'votes-http-test' });
const resumed = await store.getVoteWindow(roundId);
assert.ok(resumed && !resumed.paused && resumed.remaining_ms <= frozen.remaining_ms && resumed.remaining_ms > frozen.remaining_ms - 1000);
// Concurrent distinct sessions must share the database global rate bound.
const submissions = await Promise.allSettled(Array.from({ length: 21 }, () => store.submitVote({ roundId, sessionId: randomUUID(), requestId: randomUUID(), optionId: 'bus' })));
assert.equal(submissions.filter(result => result.status === 'fulfilled').length, 20);
const rejected = submissions.filter(result => result.status === 'rejected');
assert.equal(rejected.length, 1);
assert.ok(rejected[0]!.status === 'rejected' && rejected[0]!.reason instanceof LiveStoreError && rejected[0]!.reason.status === 429);
await delay(1100);
let attempts = 0;
const lostAckFetch: typeof fetch = async (input, init) => {
  const response = await localFetch(input, init);
  if (String(input).endsWith('/rpc/live_submit_vote')) {
    attempts++; assert.equal(response.status, 200); await response.arrayBuffer(); throw new Error('Synthetic lost response');
  }
  return response;
};
const interrupted = new LiveStore({ supabaseUrl: 'https://votes-test.invalid', serviceRoleKey: tokens.service_role, fetch: lostAckFetch });
const uncertain = { roundId, sessionId: randomUUID(), requestId: randomUUID(), optionId: 'supplier-delay' as const };
await assert.rejects(interrupted.submitVote(uncertain), { code: 'transport' });
assert.equal(attempts, 1);
const recovered = await store.submitVote(uncertain);
assert.equal(recovered.replayed, true);
assert.equal((await store.getVoteReceipt({ roundId, sessionId: uncertain.sessionId }))?.request_id, uncertain.requestId);
const publicWindow = await rpc('live_get_vote_window', 'anon', { p_round_id: roundId });
assert.equal(publicWindow.status, 200);
const publicText = JSON.stringify(await publicWindow.json());
assert.ok(!publicText.match(/session_id|request_id|actor_id|seed|recovery/));
assert.deepEqual((await store.getVoteWindow(roundId))?.counts, { bus: 20, rain: 1, 'supplier-delay': 1 });
const remaining = (await store.getVoteWindow(roundId))!.remaining_ms;
await delay(remaining + 20);
assert.equal((await store.getVoteWindow(roundId))?.status, 'locked');
await assert.rejects(store.submitVote({ ...uncertain, requestId: randomUUID() }), { code: 'http', status: 409 });
assert.equal((await store.submitVote(uncertain)).replayed, true, 'Accepted retries survive deadline');
await store.controlRound({ roundId, requestId: randomUUID(), action: 'pause', expectedRevision: 2, actorId: 'votes-http-test' });
await store.controlRound({ roundId, requestId: randomUUID(), action: 'resume', expectedRevision: 3, actorId: 'votes-http-test' });
assert.equal((await store.getVoteWindow(roundId))?.status, 'locked', 'Pausing after deadline cannot reopen voting');
await store.controlRound({ roundId, requestId: randomUUID(), action: 'stop', expectedRevision: 4, actorId: 'votes-http-test' });
assert.equal((await store.getVoteWindow(roundId))?.status, 'disabled');
assert.equal((await store.submitVote(uncertain)).replayed, true, 'Accepted receipt remains durable after stop');
console.log('Local voting HTTP validation passed: signed sessions, durable receipts, changes/retries, concurrent rate limits, paused deadlines, exact closure, lost acknowledgement and role/privacy boundaries. Synthetic opt-in fixture only; no live effect integration or hosted claim.');
