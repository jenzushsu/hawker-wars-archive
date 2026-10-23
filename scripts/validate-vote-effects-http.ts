import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { LiveStore } from '../packages/live/src/store.ts';
import { createRulesRoundInput, runRulesTick } from '../packages/live/src/worker.ts';
import { handleVoteRequest } from '../packages/live/src/vote-gateway.ts';
import { applyVoteResolution, resolveVoteCounts } from '../packages/live/src/vote-resolution.ts';
import { createDemandSchedule, arrivalsAt, eventAt, toEngineArrival, type DemandSchedule } from '../packages/simulation/src/demand.ts';
import { createInitialFrame, advanceTick, prepareTick, applyAction, settle } from '../packages/simulation/src/engine.ts';
import { getLegalActions } from '../packages/simulation/src/legality.ts';
import { chooseRules } from '../packages/decisions/src/rules.ts';
import { canonicalState } from '../packages/simulation/src/hash.ts';
import { scoreState } from '../packages/simulation/src/scoring.ts';

const secret = process.env.P5_HTTP_JWT_SECRET;
if (!secret || secret.length < 32) throw new Error('Missing disposable gateway secret');
const origin = 'http://127.0.0.1:3102';
const roundId = '11111111-1111-4111-8111-111111111111';
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
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://effects-test.invalid');
  assert.ok(url.pathname.startsWith('/rest/v1/'));
  return fetch(`${origin}${url.pathname.slice('/rest/v1'.length)}`, init);
};
function client(transport: typeof fetch = localFetch) {
  return new LiveStore({ supabaseUrl: 'https://effects-test.invalid', serviceRoleKey: tokens.service_role, fetch: transport });
}
const store = client();
let ready = false;
for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await rpc('live_get_vote_result', 'anon', { p_round_id: roundId })).ok) { ready = true; break; } } catch { /* bounded startup */ }
  await delay(100);
}
assert.ok(ready);
for (const role of ['anon', 'authenticated'] as const) {
  const denied = await rpc('live_resolve_vote_window', role, { p_round_id: roundId, p_owner_id: randomUUID(), p_fence: 1 });
  assert.equal(denied.status, role === 'anon' ? 401 : 403);
  assert.equal((await denied.json()).code, '42501');
}
async function run(round: string, expectedTick: number, target = store) {
  const result = await runRulesTick(target, { roundId: round, ownerId: randomUUID() });
  assert.equal(result.tick, expectedTick);
  assert.equal(result.status, expectedTick === 120 ? 'completed' : 'committed');
  return result;
}
async function recovery(round: string) {
  const ownerId = randomUUID();
  const lease = await store.acquireLease({ roundId: round, ownerId, ttlSeconds: 30 });
  try { return (await store.getRecovery({ roundId: round, ownerId, fence: lease.fence })).recovery; }
  finally { await store.releaseLease({ roundId: round, ownerId, fence: lease.fence }); }
}
async function opening(round: string, seed: number) {
  await store.createRound(createRulesRoundInput(round, seed, true, true));
  for (let tick = 0; tick <= 30; tick++) {
    await run(round, tick);
    if (tick === 29) assert.equal(await store.getVoteWindow(round), null, 'Window cannot open before committed tick30');
  }
  const window = await store.getVoteWindow(round);
  assert.equal(window?.status, 'open');
  assert.ok(window.remaining_ms > 19000);
  assert.equal((await store.getRoundStatus(round))?.sequence, 31);
}
function offline(schedule: DemandSchedule, lastTick: number) {
  let frame = createInitialFrame();
  for (let tick = 0; tick <= lastTick; tick++) {
    if (frame.stage === 'committed') frame = advanceTick(frame);
    const promotion = frame.state.promotion;
    const active = !!promotion && promotion.startsAt <= tick && promotion.endsAt >= tick;
    const event = eventAt(schedule, tick);
    frame = prepareTick(frame, { arrivals: arrivalsAt(schedule, tick, active).map(toEngineArrival), ...(event ? { event } : {}) });
    frame = applyAction(frame, chooseRules(frame.state, getLegalActions(frame.state)).action);
  }
  return frame;
}
await opening(roundId, 7);
const gatewayOptions = { signingKey: 'local-effects-only-vote-signing-key-12345678901234567890', origin: 'https://app.example', store: () => store };
function browser(body: unknown, cookie?: string) {
  return new Request(`${gatewayOptions.origin}/api/votes`, { method: 'POST', headers: { Origin: gatewayOptions.origin,
    'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
}
let voterCookie = '';
for (const optionId of ['bus', 'rain', 'supplier-delay'] as const) {
  const issued = await handleVoteRequest(browser({ action: 'session', roundId }), gatewayOptions);
  assert.equal(issued.status, 200);
  voterCookie = issued.headers.get('set-cookie')!.split(';')[0]!;
  const accepted = await handleVoteRequest(browser({ action: 'submit', roundId, requestId: randomUUID(), optionId }, voterCookie), gatewayOptions);
  assert.equal(accepted.status, 200);
}
const remaining = (await store.getVoteWindow(roundId))!.remaining_ms;
await delay(remaining + 20);
let resolutionAttempts = 0;
const lostResolution: typeof fetch = async (input, init) => {
  const response = await localFetch(input, init);
  if (String(input).endsWith('/rpc/live_resolve_vote_window')) {
    resolutionAttempts++; assert.equal(response.status, 200); await response.arrayBuffer(); throw new Error('Synthetic lost resolution acknowledgement');
  }
  return response;
};
await assert.rejects(runRulesTick(client(lostResolution), { roundId, ownerId: randomUUID() }), { code: 'store' });
assert.equal(resolutionAttempts, 1);
const expectedResolution = resolveVoteCounts({ roundId, seed: 7, effectiveTick: 31, counts: { bus: 1, rain: 1, 'supplier-delay': 1 } });
const pending = await store.getVoteResult(roundId);
assert.equal(pending?.winner, expectedResolution.winner);
assert.equal(pending?.applied, false);
assert.equal((await store.getRoundStatus(roundId))?.tick, 30, 'Lost resolution acknowledgement must not advance simulation');
await store.controlRound({ roundId, requestId: randomUUID(), action: 'pause', expectedRevision: 0, actorId: 'effects-http-test' });
assert.equal((await runRulesTick(store, { roundId, ownerId: randomUUID() })).status, 'paused');
assert.equal((await store.getVoteResult(roundId))?.applied, false);
await store.controlRound({ roundId, requestId: randomUUID(), action: 'resume', expectedRevision: 1, actorId: 'effects-http-test' });
let commitAttempts = 0;
const lostCommit: typeof fetch = async (input, init) => {
  const response = await localFetch(input, init);
  if (String(input).endsWith('/rpc/live_commit_tick')) {
    commitAttempts++; assert.equal(response.status, 200); await response.arrayBuffer(); throw new Error('Synthetic lost effect commit acknowledgement');
  }
  return response;
};
await assert.rejects(runRulesTick(client(lostCommit), { roundId, ownerId: randomUUID() }), { code: 'store' });
assert.equal(commitAttempts, 1);
assert.equal((await store.getRoundStatus(roundId))?.tick, 31);
assert.equal((await store.getVoteResult(roundId))?.applied, true);
const applied = await recovery(roundId);
assert.deepEqual(applied.voteResolution, expectedResolution);
const expectedSchedule = applyVoteResolution(createDemandSchedule(7), expectedResolution);
assert.equal(canonicalState(applied.resolvedSchedule), canonicalState(expectedSchedule));
assert.equal(canonicalState(applied.frame), canonicalState(offline(expectedSchedule, 31)));
for (let tick = 32; tick <= 119; tick++) await run(roundId, tick, client());
const finalRecovery = await recovery(roundId);
const expectedFrame = offline(expectedSchedule, 119);
assert.equal(canonicalState(finalRecovery.frame), canonicalState(expectedFrame));
assert.equal(expectedFrame.appliedEvents.length, 1);
await run(roundId, 120);
const terminal = await store.getSnapshot(roundId);
const score = scoreState(settle(advanceTick(expectedFrame)).state);
assert.equal(terminal?.snapshot.policies[0]?.profit_cents, score.profitCents);
assert.equal(terminal?.snapshot.policies[0]?.utility_points, score.utilityPoints);
const events = await store.getEvents({ roundId, afterSequence: 30, limit: 100 });
assert.deepEqual(events.events.map(event => event.sequence), Array.from({ length: 91 }, (_, index) => index + 31));
const publicResult = await rpc('live_get_vote_result', 'anon', { p_round_id: roundId });
assert.equal(publicResult.status, 200);
assert.ok(!JSON.stringify(await publicResult.json()).match(/session|request|seed|draw_|tied_options|recovery|schedule/));
const status = await handleVoteRequest(browser({ action: 'status', roundId }, voterCookie), gatewayOptions);
assert.equal(status.status, 200);
assert.equal((await status.json()).result.applied, true);

const emptyRound = '33333333-3333-4333-8333-333333333333';
await opening(emptyRound, 9);
await delay((await store.getVoteWindow(emptyRound))!.remaining_ms + 20);
await run(emptyRound, 31);
const noVote = await store.getVoteResult(emptyRound);
assert.equal(noVote?.winner, null); assert.equal(noVote?.ends_at, null); assert.equal(noVote?.applied, true);
const noVoteRecovery = await recovery(emptyRound);
assert.equal(canonicalState(noVoteRecovery.resolvedSchedule), canonicalState(createDemandSchedule(9)));
assert.equal(canonicalState(noVoteRecovery.frame), canonicalState(offline(createDemandSchedule(9), 31)));
assert.deepEqual((noVoteRecovery.frame as { appliedEvents: unknown[] }).appliedEvents, []);
console.log('Local effects HTTP validation passed: real worker auto-open, signed votes, deterministic tie/no-vote resolution, lost resolution/commit acknowledgements, pause-before-apply, restart replay, one effect, completed scores and public-result privacy. Disposable test DB omits visual pacing; real vote deadlines remain intact. No hosted/provider claim.');
