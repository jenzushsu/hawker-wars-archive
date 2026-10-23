import assert from 'node:assert/strict';
import { VotingRound } from '../packages/live/src/voting.ts';

// Deterministic worker inputs only. This does not start a server or accept real votes.
const round = new VotingRound({ roundId: 'offline-voting-demo', classification: 'exhibition', seed: 7 });
for (let tick = 0; tick <= 30; tick++) round.commitTick(tick, 1_000);
round.submit({ sessionId: 'demo-a', requestId: 'first', optionId: 'bus' }, 2_000);
round.submit({ sessionId: 'demo-a', requestId: 'changed', optionId: 'rain' }, 3_000);
round.submit({ sessionId: 'demo-a', requestId: 'first', optionId: 'bus' }, 4_000);
assert.equal(round.receipt('demo-a')?.optionId, 'rain');
round.pause(6_000);
assert.equal(round.snapshot(16_000).remainingMs, 15_000);
round.resume(26_000);
assert.equal(round.snapshot(26_000).deadlineMs, 41_000);
round.submit({ sessionId: 'demo-b', requestId: 'first', optionId: 'rain' }, 40_999);
assert.throws(() => round.submit({ sessionId: 'demo-c', requestId: 'late', optionId: 'bus' }, 41_000));
const resolution = round.resolve(41_000);
assert.equal(resolution.winner, 'rain');
const effect = round.schedule(41_000);
assert.deepEqual(effect, { id: 'vote:offline-voting-demo:0', type: 'rain', effectiveTick: 31, endsAt: 40 });
const scheduled = round.snapshot(41_000);
round.commitTick(31, 41_000);
assert.equal(round.snapshot(41_000).status, 'active');
for (let tick = 32; tick <= 41; tick++) round.commitTick(tick, 41_000);
const expired = round.snapshot(41_000);
assert.equal(expired.status, 'expired');
console.log(JSON.stringify({ classification: 'offline-voting-demonstration', networkCalls: 0,
  note: 'In-memory worker-core example; no real audience votes, persistence or engine execution.',
  scheduled, expired }, null, 2));
