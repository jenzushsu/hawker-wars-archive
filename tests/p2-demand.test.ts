import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  arrivalsAt, createDemandSchedule, eventAt, keyedDraw, toEngineArrival,
  type DemandStream,
} from '../packages/simulation/src/demand.js';

const vectors = JSON.parse(readFileSync(new URL('../fixtures/reference/demand-vectors.json', import.meta.url), 'utf8')) as {
  vectors: { seed: number; stream: DemandStream; tick: number; index: number; input: string; digestHex: string; r: number }[];
};

describe('demand-1 keyed deterministic draws', () => {
  it.each(vectors.vectors)('matches independently authored Python SHA-256 vector $stream/$seed/$tick/$index', vector => {
    const draw = keyedDraw(vector.seed, vector.stream, vector.tick, vector.index);
    expect(draw.input).toBe(vector.input);
    expect(draw.digestHex).toBe(vector.digestHex);
    expect(draw.r).toBe(vector.r);
    expect(draw.u).toBe(vector.r / 4294967296);
    expect(draw.u).toBeGreaterThanOrEqual(0);
    expect(draw.u).toBeLessThan(1);
  });

  it('rejects noncanonical integer inputs and unknown streams', () => {
    for (const seed of [-1, -0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => keyedDraw(seed, 'base_count', 0, 0)).toThrow();
    }
    expect(() => keyedDraw(0, 'unknown' as DemandStream, 0, 0)).toThrow();
    expect(() => keyedDraw(0, 'base_count', -1, 0)).toThrow();
    expect(() => keyedDraw(0, 'base_count', 0, 0.5)).toThrow();
  });

  it('does not share consumption state across streams or call order', () => {
    const before = keyedDraw(7, 'base_count', 60, 0);
    for (let i = 0; i < 20; i++) keyedDraw(7, 'patience', 60, i);
    keyedDraw(7, 'vote_tie', 0, 0);
    expect(keyedDraw(7, 'base_count', 60, 0)).toEqual(before);
  });
});

describe('potential schedules and local realization', () => {
  it('has the independently checked seed-0 demand counts at phase boundaries', () => {
    const schedule = createDemandSchedule(0);
    const baseCounts = schedule.ticks.map(row => row.filter(a => a.source === 'base').length);
    // Expected numbers independently computed from Python hashlib, not the implementation under test.
    expect([0, 29, 30, 60, 89, 90, 119].map(tick => baseCounts[tick])).toEqual([1, 2, 2, 2, 1, 0, 1]);
    expect(baseCounts.reduce((sum, n) => sum + n, 0)).toBe(125);
    expect(schedule.ticks).toHaveLength(120);
    for (const [tick, row] of schedule.ticks.entries()) {
      const base = row.filter(a => a.source === 'base');
      expect(base.length).toBeGreaterThanOrEqual(tick >= 30 && tick <= 89 ? 1 : 0);
      expect(base.length).toBeLessThanOrEqual(2);
      expect(row.filter(a => a.source === 'promotion').length).toBeLessThanOrEqual(1);
    }
  });

  it('reconstructs the same immutable schedule and hash without action input', () => {
    const schedule = createDemandSchedule(1, 'supplier-delay');
    expect(createDemandSchedule(1, 'supplier-delay')).toEqual(schedule);
    expect(schedule.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(schedule)).toBe(true);
    expect(Object.isFrozen(schedule.ticks)).toBe(true);
    expect(Object.isFrozen(schedule.ticks[0])).toBe(true);
    expect(Object.isFrozen(schedule.privateToPublicIds)).toBe(true);
    expect(() => Object.assign(schedule, { seed: 2 })).toThrow();
    expect(createDemandSchedule(2, 'supplier-delay').hash).not.toBe(schedule.hash);
    expect(createDemandSchedule(1, 'rain').hash).not.toBe(schedule.hash);
  });

  it('retains stable slots and patience when rain removes an earlier base customer', () => {
    const clean = createDemandSchedule(3);
    const rain = createDemandSchedule(3, 'rain');
    const cleanBase = arrivalsAt(clean, 61).filter(a => a.source === 'base');
    const kept = arrivalsAt(rain, 61).filter(a => a.source === 'base');
    expect(cleanBase.map(a => a.slotIndex)).toEqual([0, 1]);
    expect(kept.map(a => a.slotIndex)).toEqual([1]);
    expect(kept[0]).toEqual(cleanBase[1]);
    expect(kept[0]?.publicId).toBe('customer-61-base-1');
    expect(arrivalsAt(rain, 59)).toEqual(arrivalsAt(clean, 59));
    expect(arrivalsAt(rain, 70)).toEqual(arrivalsAt(clean, 70));
  });

  it('adds exactly six bus arrivals at one boundary in base/bus/promotion order', () => {
    const bus = createDemandSchedule(0, 'bus');
    const at60 = arrivalsAt(bus, 60, true);
    expect(at60.filter(a => a.source === 'bus')).toHaveLength(6);
    expect(at60.slice(0, 2).map(a => a.source)).toEqual(['base', 'base']);
    expect(at60.slice(2, 8).map(a => a.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(at60.slice(2, 8).map(a => a.slotIndex)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(bus.ticks.flat().filter(a => a.source === 'bus')).toHaveLength(6);
    expect(eventAt(bus, 59)).toBeUndefined();
    expect(eventAt(bus, 60)).toMatchObject({ type: 'bus', effectiveTick: 60, endsAt: 60 });
    expect(eventAt(bus, 61)).toBeUndefined();
  });

  it('filters promotion without mutating or renumbering the common potential schedule', () => {
    const schedule = createDemandSchedule(7, 'rain');
    const serialized = JSON.stringify(schedule);
    for (let tick = 0; tick < 120; tick++) {
      const inactive = arrivalsAt(schedule, tick, false);
      const active = arrivalsAt(schedule, tick, true);
      expect(inactive.every(a => a.source !== 'promotion')).toBe(true);
      expect(active.filter(a => a.source !== 'promotion')).toEqual(inactive);
      for (const a of active) {
        expect(a.patience).toBeGreaterThanOrEqual(3);
        expect(a.patience).toBeLessThanOrEqual(10);
        expect(a.deadlineTick).toBe(a.arrivalTick + a.patience);
      }
    }
    expect(JSON.stringify(schedule)).toBe(serialized);
  });

  it('strips seed-bearing IDs and draw metadata from engine arrivals with a stable private mapping', () => {
    const schedule = createDemandSchedule(7);
    for (const a of schedule.ticks.flat()) {
      const projected = toEngineArrival(a);
      expect(Object.keys(projected).sort()).toEqual(['arrivalTick', 'deadlineTick', 'id', 'patience']);
      expect(projected.id).toBe(a.publicId);
      expect(projected.id).not.toContain('seed-');
      expect(a.id).toContain('seed-7:');
      expect(schedule.privateToPublicIds[a.id]).toBe(projected.id);
    }
  });

  it('rejects invalid schedule selectors and tick selection', () => {
    expect(() => createDemandSchedule(0, 'unknown' as 'clean')).toThrow();
    expect(() => createDemandSchedule(0, 'rain', 120)).toThrow();
    expect(() => arrivalsAt(createDemandSchedule(0), 120)).toThrow();
    expect(() => eventAt(createDemandSchedule(0), -1)).toThrow();
  });
});
