import { describe, expect, it } from 'vitest';
import { VotingRound } from '../packages/live/src/voting.js';

function opened(seed = 7): VotingRound {
  const round = new VotingRound({ roundId: 'round-independent', classification: 'exhibition', seed });
  for (let tick = 0; tick <= 30; tick++) round.commitTick(tick, 1000);
  return round;
}
const vote = (sessionId: string, requestId: string, optionId: 'bus' | 'rain' | 'supplier-delay') => ({ sessionId, requestId, optionId });

describe('offline voting boundary and adversarial review', () => {
  it('uses the authoritative strict deadline, preserving the last eligible tally', () => {
    const round = opened();
    round.submit(vote('session-first', 'request-first', 'bus'), 20_999);
    const before = round.snapshot(20_999).counts;
    expect(() => round.submit(vote('session-late', 'request-late', 'rain'), 21_000)).toThrow();
    expect(round.snapshot(21_000).counts).toEqual(before);
    expect(round.resolve(21_000).winner).toBe('bus');
  });

  it('isolates request keys by session and never reapplies a stale accepted retry', () => {
    const round = opened();
    const first = round.submit(vote('session-a', 'same-request', 'bus'), 1001);
    round.submit(vote('session-b', 'same-request', 'supplier-delay'), 1002);
    const changed = round.submit(vote('session-a', 'new-request', 'rain'), 1003);
    const before = round.snapshot(1003).counts;
    expect(round.submit(vote('session-a', 'same-request', 'bus'), 1004)).toEqual(first);
    expect(round.snapshot(1004).counts).toEqual(before);
    expect(round.receipt('session-a')).toEqual(changed);
    expect(() => round.submit(vote('session-a', 'same-request', 'rain'), 1005)).toThrow();
    expect(round.snapshot(1005).counts).toEqual(before);
    // A retry acknowledges only the original accepted request after closure.
    expect(round.submit(vote('session-a', 'same-request', 'bus'), 21_000)).toEqual(first);
    expect(round.receipt('session-a')).toEqual(changed);
    expect(round.snapshot(21_000).counts).toEqual(before);
  });

  it('freezes the countdown during pause without allowing a paused vote or simulation advance', () => {
    const round = opened();
    round.pause(6000);
    expect(round.snapshot(16_000).remainingMs).toBe(15_000);
    expect(() => round.submit(vote('session-paused', 'request-paused', 'bus'), 16_000)).toThrow();
    expect(() => round.commitTick(31, 16_000)).toThrow();
    round.resume(26_000);
    expect(round.snapshot(26_000).deadlineMs).toBe(41_000);
    round.submit(vote('session-last', 'request-last', 'rain'), 40_999);
    expect(() => round.submit(vote('session-late', 'request-late', 'bus'), 41_000)).toThrow();
    expect(round.resolve(41_000).winner).toBe('rain');
  });

  it('has independent Python SHA-256 tie vectors unaffected by vote arrival order', () => {
    // Python hashlib.sha256 over hawker-wars|demand-1|seed|vote_tie|0|0.
    const vectors = [
      { seed: 0, digest: 'a2714b6775a624dbc239743ca0fee84574e9fbd2f38e3969b46b0e7ee8c9b3b3', r: 2725333863, winner: 'rain' },
      { seed: 99, digest: '42d6648ca3ba361ae3aaaddf31486363160f329f830ac82a9211659a2defc15a', r: 1121346700, winner: 'bus' },
    ];
    for (const vector of vectors) {
      const round = opened(vector.seed);
      round.submit(vote('session-z', 'request-z', 'supplier-delay'), 1001);
      round.submit(vote('session-b', 'request-b', 'rain'), 1002);
      round.submit(vote('session-a', 'request-a', 'bus'), 1003);
      const resolution = round.resolve(21_000);
      expect(resolution.tiedOptions).toEqual(['bus', 'rain', 'supplier-delay']);
      expect(resolution.winner).toBe(vector.winner);
      expect(resolution.draw).toMatchObject({ digestHex: vector.digest, r: vector.r });
      const reversed = opened(vector.seed);
      reversed.submit(vote('session-a', 'request-a', 'bus'), 1001);
      reversed.submit(vote('session-b', 'request-b', 'rain'), 1002);
      reversed.submit(vote('session-z', 'request-z', 'supplier-delay'), 1003);
      expect(reversed.resolve(21_000)).toEqual(resolution);
    }
  });

  it('does not create an event for an empty window or reopen the single window later', () => {
    const round = opened();
    expect(round.resolve(21_000).winner).toBeNull();
    expect(round.schedule(21_000)).toBeNull();
    expect(round.schedule(21_000)).toBeNull();
    for (let tick = 31; tick <= 120; tick++) round.commitTick(tick, 21_000);
    expect(round.snapshot(21_000).status).not.toBe('open');
    expect(() => round.submit(vote('session-too-late', 'request-too-late', 'bus'), 21_001)).toThrow();
  });

  it('cannot skip the resolution boundary by committing more ticks after the deadline', () => {
    const round = opened();
    round.submit(vote('session-winner', 'request-winner', 'rain'), 1001);
    expect(() => round.commitTick(31, 21_000)).toThrow();
    expect(round.snapshot(21_000).committedTick).toBe(30);
    round.resolve(21_000);
    expect(() => round.commitTick(31, 21_000)).toThrow();
    expect(round.schedule(21_000)).toMatchObject({ type: 'rain', effectiveTick: 31, endsAt: 40 });
    round.commitTick(31, 21_000);
    expect(round.snapshot(21_000).status).toBe('active');
    for (let tick = 32; tick <= 40; tick++) round.commitTick(tick, 21_000);
    expect(round.snapshot(21_000).status).toBe('active');
    round.commitTick(41, 21_000);
    expect(round.snapshot(21_000).status).toBe('expired');
  });

  it('keeps all non-exhibition manifest classes unable to accept or resolve votes', () => {
    for (const classification of ['offline-contract', 'clean', 'stress', 'replay'] as const) {
      const round = new VotingRound({ roundId: 'benchmark-round', classification, seed: 7 });
      for (let tick = 0; tick <= 30; tick++) round.commitTick(tick, 1000);
      expect(round.snapshot(1000).enabled).toBe(false);
      expect(round.snapshot(1000).eligibleOptions).toEqual([]);
      expect(() => round.submit(vote('session-a', 'request-a', 'bus'), 1001)).toThrow();
      expect(() => round.resolve(21_000)).toThrow();
      expect(() => round.schedule(21_000)).toThrow();
      expect(round.receipt('session-a')).toBeNull();
    }
  });

  it('checks deadline overflow before committing the opening tick', () => {
    const round = new VotingRound({ roundId: 'overflow-round', classification: 'exhibition', seed: 7 });
    for (let tick = 0; tick < 30; tick++) round.commitTick(tick, 1000);
    expect(() => round.commitTick(30, Number.MAX_SAFE_INTEGER)).toThrow();
    expect(round.snapshot(1000).committedTick).toBe(29);
    round.commitTick(30, 1000);
    expect(round.snapshot(1000).deadlineMs).toBe(21_000);
  });

  it('can settle an empty window at the final boundary without attempting an event', () => {
    const round = opened();
    for (let tick = 31; tick <= 119; tick++) round.commitTick(tick, 1001);
    expect(round.resolve(21_000).winner).toBeNull();
    expect(round.schedule(21_000)).toBeNull();
    round.commitTick(120, 21_000);
    expect(round.snapshot(21_000).effect).toBeNull();
    expect(round.snapshot(21_000).status).toBe('expired');
  });

  it('projects aggregate public state without seed, draw, voter identity or request records', () => {
    const round = opened(99);
    round.submit(vote('private-session-alpha', 'private-request-alpha', 'bus'), 1001);
    round.submit(vote('private-session-beta', 'private-request-beta', 'rain'), 1002);
    round.resolve(21_000);
    round.schedule(21_000);
    const snapshot = round.snapshot(21_000);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(/private-session|private-request|seed|digestHex|vote_tie|acceptedAt|sessionId|requestId/);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.counts)).toBe(true);
    expect(() => Object.assign(snapshot.counts, { bus: 1000 })).toThrow();
    expect(round.snapshot(21_000)).toEqual(snapshot);
  });

  it('rejects invalid identities, actions, server times and clock reversal without accepting a vote', () => {
    for (const now of [-1, -0, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const round = opened();
      expect(() => round.submit(vote('session-valid', 'request-valid', 'rain'), now)).toThrow();
      expect(round.receipt('session-valid')).toBeNull();
    }
    const round = opened();
    for (const identity of ['', ' space', 'é', 'x'.repeat(129)]) {
      expect(() => round.submit(vote(identity, 'request-valid', 'rain'), 1001)).toThrow();
      expect(() => round.submit(vote('session-valid', identity, 'rain'), 1001)).toThrow();
    }
    expect(() => round.submit({ ...vote('session-valid', 'request-valid', 'bus'), optionId: 'viral-hype' } as never, 1001)).toThrow();
    round.snapshot(2000);
    expect(() => round.submit(vote('session-valid', 'request-valid', 'rain'), 1999)).toThrow();
    expect(round.receipt('session-valid')).toBeNull();
  });
});
