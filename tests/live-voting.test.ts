import { describe, expect, it } from 'vitest';
import { VotingRound, type VoteClassification, type VoteOption } from '../packages/live/src/voting.ts';

const create = (classification: VoteClassification = 'exhibition') => new VotingRound({ roundId: 'round-1', classification, seed: 7 });
function open() { const round = create(); for (let t = 0; t <= 30; t++) round.commitTick(t, 1000); return round; }
function chosen(option: VoteOption) {
  const round = open(); round.submit({ sessionId: 'session-1', requestId: 'request-1', optionId: option }, 1001);
  round.resolve(21_000); return round;
}

describe('P5 offline exhibition voting core', () => {
  it('opens only after the committed tick30, and read calls never open a window', () => {
    const round = create(); expect(round.snapshot(1000).status).toBe('closed');
    for (let tick = 0; tick < 30; tick++) round.commitTick(tick, 1000);
    expect(round.snapshot(1000).status).toBe('closed');
    expect(() => round.commitTick(31, 1000)).toThrow('tick-order');
    round.commitTick(30, 1000);
    expect(round.snapshot(1000)).toMatchObject({ status: 'open', deadlineMs: 21_000, remainingMs: 20_000, committedTick: 30 });
    expect(() => round.commitTick(30, 1000)).toThrow('tick-order');
  });
  it.each(['offline-contract', 'clean', 'stress', 'replay'] as const)('refuses mutations to %s runs', classification => {
    const round = create(classification);
    for (let tick = 0; tick <= 30; tick++) round.commitTick(tick, 1000);
    expect(round.snapshot(1000)).toMatchObject({ status: 'closed', enabled: false, eligibleOptions: [] });
    expect(() => round.submit({ sessionId: 's', requestId: 'r', optionId: 'bus' }, 1001)).toThrow('benchmark');
    expect(() => round.resolve(21_000)).toThrow('benchmark');
    expect(() => round.schedule(21_000)).toThrow('benchmark');
  });
  it('rejects runtime-unknown classifications and invalid seeds', () => {
    expect(() => create('live' as VoteClassification)).toThrow('classification');
    for (const seed of [-1, -0, 1.5, NaN, Infinity]) expect(() => new VotingRound({ roundId: 'round-1', classification: 'exhibition', seed })).toThrow('seed');
  });
  it.each(['bus', 'rain', 'supplier-delay'] as const)('schedules and expires %s using engine inclusive tick semantics', option => {
    const round = chosen(option); const effect = round.schedule(21_000)!;
    expect(effect).toEqual({ id: 'vote:round-1:0', type: option, effectiveTick: 31, endsAt: option === 'bus' ? 31 : 40 });
    expect(round.schedule(21_000)).toBe(effect);
    expect(round.snapshot(21_000).status).toBe('scheduled');
    round.commitTick(31, 21_000); expect(round.snapshot(21_000).status).toBe('active');
    for (let tick = 32; tick <= effect.endsAt; tick++) round.commitTick(tick, 21_000);
    expect(round.snapshot(21_000).status).toBe('active');
    round.commitTick(effect.endsAt + 1, 21_000); expect(round.snapshot(21_000).status).toBe('expired');
    round.disable(21_000); expect(round.snapshot(21_000).effect).toEqual(effect);
  });
  it('operator disablement is irreversible and does not undo a scheduled effect', () => {
    const round = chosen('rain'); const effect = round.schedule(21_000);
    round.disable(21_000);
    expect(round.snapshot(21_000)).toMatchObject({ status: 'scheduled', enabled: false, effect });
    round.commitTick(31, 21_000);
    expect(round.snapshot(21_000)).toMatchObject({ status: 'active', effect });
    expect(round.schedule(21_000)).toEqual(effect);
    const disabled = open(); disabled.disable(1001);
    expect(() => disabled.submit({ sessionId: 's', requestId: 'r', optionId: 'bus' }, 1002)).toThrow('closed');
    expect(() => disabled.resolve(21_000)).toThrow('not-locked');
    for (let tick = 31; tick <= 120; tick++) disabled.commitTick(tick, 21_000);
    expect(disabled.snapshot(21_000).effect).toBeNull();
  });
  it('refuses scheduling at closing and leaves rain duration untruncated before closing', () => {
    const late = open(); late.submit({ sessionId: 's', requestId: 'r', optionId: 'rain' }, 1001);
    for (let tick = 31; tick <= 118; tick++) late.commitTick(tick, 1002);
    late.resolve(21_000); const effect = late.schedule(21_000);
    expect(effect).toMatchObject({ effectiveTick: 119, endsAt: 128 });
    late.commitTick(119, 21_000); expect(late.snapshot(21_000).status).toBe('active');
    late.commitTick(120, 21_000); expect(late.snapshot(21_000).status).toBe('expired');
    expect(() => late.commitTick(121, 21_000)).toThrow('tick-order');
    const closing = open(); closing.submit({ sessionId: 's', requestId: 'r', optionId: 'rain' }, 1001);
    for (let tick = 31; tick <= 119; tick++) closing.commitTick(tick, 1002);
    closing.resolve(21_000); expect(() => closing.schedule(21_000)).toThrow('closing');
    expect(closing.snapshot(21_000).effect).toBeNull();
    closing.disable(21_000); closing.commitTick(120, 21_000);
  });
  it('preflights deadline overflow without partially committing tick30 or resuming', () => {
    const round = create(); for (let tick = 0; tick <= 29; tick++) round.commitTick(tick, 1000);
    expect(() => round.commitTick(30, Number.MAX_SAFE_INTEGER)).toThrow('clock-overflow');
    expect(round.snapshot(1000)).toMatchObject({ committedTick: 29, status: 'closed' });
    round.commitTick(30, 1000); round.pause(2000);
    expect(() => round.resume(Number.MAX_SAFE_INTEGER)).toThrow('clock-overflow');
    expect(round.snapshot(2000)).toMatchObject({ paused: true, remainingMs: 19_000, eligibleOptions: [] });
    round.resume(3000); expect(round.snapshot(3000).deadlineMs).toBe(22_000);
  });
});
