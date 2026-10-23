import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyVoteResolution, ResolutionSchema, resolveVoteCounts } from '../packages/live/src/vote-resolution.ts';
import { createDemandSchedule } from '../packages/simulation/src/demand.ts';
import { StoredScheduleSchema } from '../packages/replay/src/schema.ts';

const roundId = '11111111-1111-4111-8111-111111111111';
const counts = { bus: 0, rain: 0, 'supplier-delay': 0 };
const resolve = (votes = counts, effectiveTick = 35, seed = 7) => resolveVoteCounts({ roundId, seed, effectiveTick, counts: votes });

describe('durable vote resolution and stored schedule transformation', () => {
  it('records no-vote evidence and preserves the exact original schedule identity', () => {
    const base = createDemandSchedule(7);
    const resolution = resolve();
    expect(resolution).toMatchObject({ winner: null, tied_options: [], draw_r: null, draw_digest: null });
    expect(applyVoteResolution(base, resolution)).toBe(base);
  });
  it.each(['bus', 'rain', 'supplier-delay'] as const)('selects a unique %s maximum without a tie draw', winner => {
    const resolution = resolve({ ...counts, [winner]: 2 });
    expect(resolution).toMatchObject({ winner, tied_options: [winner], draw_r: null, draw_digest: null });
    const base = createDemandSchedule(7);
    const result = applyVoteResolution(base, resolution);
    expect(result.shock).toEqual({ id: `vote:${roundId}:0`, type: winner, effectiveTick: 35, endsAt: winner === 'bus' ? 35 : 44 });
    expect(result.hash).not.toBe(base.hash);
    expect(StoredScheduleSchema.safeParse(result).success).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    if (winner !== 'bus') {
      expect(result.ticks).toEqual(base.ticks);
      expect(result.privateToPublicIds).toEqual(base.privateToPublicIds);
    }
  });
  it('matches independent SHA-256 tie vectors and lexical option ordering', () => {
    for (const seed of [0, 7, 99]) {
      const digest = createHash('sha256').update(`hawker-wars|demand-1|${seed}|vote_tie|0|0`).digest();
      const r = digest.readUInt32BE();
      for (const votes of [{ bus: 4, rain: 4, 'supplier-delay': 0 }, { bus: 4, rain: 4, 'supplier-delay': 4 }]) {
        const tied = Object.keys(votes).filter(id => votes[id as keyof typeof votes] === 4).sort();
        expect(resolve(votes, 35, seed)).toMatchObject({ tied_options: tied, draw_r: r,
          draw_digest: digest.toString('hex'), winner: tied[Math.floor(r * tied.length / 4294967296)] });
      }
    }
  });
  it('adds bus arrivals without rerolling base or promotional potentials or mutating prior/future ticks', () => {
    const base = createDemandSchedule(7);
    const tick = base.ticks.findIndex((arrivals, index) => index >= 31 && arrivals.some(a => a.source === 'promotion'));
    const before = JSON.stringify(base);
    const result = applyVoteResolution(base, resolve({ ...counts, bus: 1 }, tick));
    expect(JSON.stringify(base)).toBe(before);
    expect(result.ticks.slice(0, tick)).toEqual(base.ticks.slice(0, tick));
    expect(result.ticks.slice(tick + 1)).toEqual(base.ticks.slice(tick + 1));
    const added = result.ticks[tick]!.filter(a => a.source === 'bus');
    expect(added).toHaveLength(6);
    for (const arrival of base.ticks[tick]!) {
      expect(result.ticks[tick]!.find(a => a.id === arrival.id)).toEqual({ ...arrival,
        slotIndex: arrival.slotIndex + (arrival.source === 'promotion' ? 6 : 0) });
    }
    for (const arrival of added) {
      const digest = createHash('sha256').update(`hawker-wars|demand-1|7|patience|${tick}|${arrival.slotIndex}`).digest();
      expect(arrival.patience).toBe(3 + digest.readUInt32BE() % 8);
      expect(arrival.deadlineTick).toBe(tick + arrival.patience);
    }
    expect(Object.keys(result.privateToPublicIds)).toHaveLength(Object.keys(base.privateToPublicIds).length + 6);
  });
  it('rejects invalid counts, identity, effect boundaries and inconsistent evidence', () => {
    for (const invalid of [{ ...counts, bus: -0 }, { ...counts, bus: -1 }, { ...counts, bus: 1.5 },
      { ...counts, bus: 401 }, { bus: 200, rain: 200, 'supplier-delay': 1 }, { ...counts, extra: 1 }]) {
      expect(() => resolve(invalid)).toThrow();
    }
    for (const tick of [30, 120, 31.5, NaN]) expect(() => resolve(counts, tick)).toThrow();
    expect(() => resolveVoteCounts({ roundId: 'bad', seed: 7, effectiveTick: 35, counts })).toThrow();
    const tied = resolve({ bus: 1, rain: 1, 'supplier-delay': 1 });
    for (const invalid of [{ ...tied, tied_options: [...tied.tied_options].reverse() }, { ...tied, draw_r: null },
      { ...tied, winner: null }, { ...tied, draw_digest: '0'.repeat(64) }, { ...tied, privateSeed: 7 }]) {
      expect(ResolutionSchema.safeParse(invalid).success).toBe(false);
    }
    expect(() => applyVoteResolution(createDemandSchedule(7, 'rain'), resolve({ ...counts, bus: 1 }))).toThrow();
    expect(() => applyVoteResolution({ ...createDemandSchedule(7), hash: '0'.repeat(64) }, tied)).toThrow();
  });
  it('rejects internally consistent tie evidence from another seed', () => {
    const resolution = resolve({ bus: 1, rain: 1, 'supplier-delay': 1 }, 35, 99);
    expect(ResolutionSchema.safeParse(resolution).success).toBe(true);
    expect(() => applyVoteResolution(createDemandSchedule(7), resolution)).toThrow('stored seed');
  });
});
