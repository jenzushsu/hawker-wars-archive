import { describe, expect, it, vi } from 'vitest';
import { arrivalsAt, createDemandSchedule, toEngineArrival } from '../packages/simulation/src/demand.js';
import { resolveMockOutcome } from '../packages/decisions/src/fallback.js';
import type { RulesState } from '../packages/decisions/src/rules.js';

const capture: RulesState = {
  tick: 10, rawPortions: 0, readyBatches: [{ id: 'batch-0', quantity: 2, expiresAt: 30 }],
  cooking: null, pendingRestock: null,
  queue: [{ id: 'customer-10-base-0', arrivalTick: 10, patience: 3, deadlineTick: 13 }],
};

describe('independent P2-A schedule/decision integration review', () => {
  it('keeps all potential arrivals immutable while promotion changes realized demand', () => {
    const schedule = createDemandSchedule(0, 'bus');
    const identity = schedule.hash;
    const all = arrivalsAt(schedule, 60, true);
    const withoutPromotion = arrivalsAt(schedule, 60, false);
    expect(all.map(a => a.publicId)).toEqual([
      'customer-60-base-0', 'customer-60-base-1',
      'customer-60-bus-0', 'customer-60-bus-1', 'customer-60-bus-2',
      'customer-60-bus-3', 'customer-60-bus-4', 'customer-60-bus-5',
      'customer-60-promotion-0',
    ]);
    expect(withoutPromotion).toEqual(all.filter(a => a.source !== 'promotion'));
    expect(schedule.hash).toBe(identity);
    expect(Object.isFrozen(schedule.ticks[60])).toBe(true);
    expect(() => Object.assign(schedule.ticks[60]![0]!, { patience: 1 })).toThrow();
  });

  it('rain can leave a hole without renumbering the survivor or changing its patience', () => {
    const schedule = createDemandSchedule(3, 'rain');
    const before = schedule.ticks[61]!;
    const after = arrivalsAt(schedule, 61, false);
    expect(before.filter(a => a.source === 'base').map(a => a.slotIndex)).toEqual([0, 1]);
    expect(after.map(a => ({ id: a.publicId, slot: a.slotIndex, patience: a.patience }))).toEqual([
      { id: 'customer-61-base-1', slot: 1, patience: 10 },
    ]);
    expect(after[0]).toBe(before[1]);
  });

  it('strips evaluator identity and arbitrary private fields at the engine input boundary', () => {
    const potential = createDemandSchedule(7).ticks.flat()[0]!;
    const poisoned = { ...potential, seed: 7, otherPolicyCash: 99999, futureEvents: ['rain'] };
    const serialized = JSON.stringify(toEngineArrival(poisoned));
    expect(JSON.parse(serialized)).toEqual({
      id: potential.publicId, arrivalTick: potential.arrivalTick,
      patience: potential.patience, deadlineTick: potential.deadlineTick,
    });
    expect(serialized).not.toMatch(/seed-|otherPolicy|futureEvents/);
  });

  it('separate schedule creation and selection never consume action-dependent random state', () => {
    const schedule = createDemandSchedule(19, 'rain');
    const expected = arrivalsAt(schedule, 68, true);
    for (let tick = 0; tick < 68; tick++) arrivalsAt(schedule, tick, tick % 2 === 0);
    expect(arrivalsAt(schedule, 68, true)).toEqual(expected);
    expect(createDemandSchedule(19, 'rain').hash).toBe(schedule.hash);
  });

  it('does not accept an illegal probability entry even when the selected action is legal', () => {
    const resolved = resolveMockOutcome({ state: capture, legalActions: ['SERVE', 'WAIT'], provider: 'jev', outcome: {
      kind: 'response', elapsedMs: 1, response: {
        provider: 'jev', action: 'SERVE', status: 'success', latencyMs: 1,
        probabilities: [{ action: 'COOK', probability: 1 }], probabilitySemantics: 'documented action distribution',
      },
    } });
    expect(resolved.origin).toBe('fallback');
    expect(resolved.fallbackReason).toBe('invalid');
    expect(resolved.appliedAction).toBe('SERVE');
  });

  it('rejects a provider mismatch without crediting a successful mock choice', () => {
    const resolved = resolveMockOutcome({ state: capture, legalActions: ['SERVE', 'WAIT'], provider: 'jev', outcome: {
      kind: 'response', elapsedMs: 1, response: { provider: 'zoom', action: 'SERVE', status: 'success', latencyMs: 1 },
    } });
    expect(resolved).toMatchObject({ origin: 'fallback', attemptedProvider: 'jev', appliedPolicy: 'rules', providerStatus: 'error' });
  });

  it('accepts the exact deadline and rejects the same action one millisecond late', () => {
    const response = { provider: 'jev', action: 'SERVE', status: 'success', latencyMs: 0 };
    const at = resolveMockOutcome({ state: capture, legalActions: ['SERVE', 'WAIT'], provider: 'jev', outcome: { kind: 'response', elapsedMs: 4000, response } });
    const late = resolveMockOutcome({ state: capture, legalActions: ['SERVE', 'WAIT'], provider: 'jev', outcome: { kind: 'response', elapsedMs: 4001, response } });
    expect(at).toMatchObject({ origin: 'mock', attemptCount: 1, appliedAction: 'SERVE' });
    expect(late).toMatchObject({ origin: 'fallback', fallbackReason: 'timeout', attemptCount: 1, appliedAction: 'SERVE' });
  });
});

// Lifecycle tests exercise real transitions, including an ordinary production ledger.
import { advanceTick, applyAction, createInitialFrame, prepareTick, settle } from '../packages/simulation/src/engine.js';

describe('independent P2-A lifecycle review', () => {
  it('never mutates an input and rejects duplicate or out-of-order phase application', () => {
    const opening = createInitialFrame();
    const snapshot = JSON.stringify(opening);
    expect(() => applyAction(opening, 'WAIT')).toThrow();
    expect(() => advanceTick(opening)).toThrow();
    expect(() => settle(opening)).toThrow();
    const decision = prepareTick(opening);
    expect(JSON.stringify(opening)).toBe(snapshot);
    expect(() => prepareTick(decision)).toThrow();
    const committed = applyAction(decision, 'WAIT');
    expect(() => applyAction(committed, 'WAIT')).toThrow();
    expect(() => prepareTick(committed)).toThrow();
    const next = advanceTick(committed);
    expect(next.boundaryTick).toBe(1);
    expect(() => advanceTick(next)).toThrow();
  });

  it('applies supplier delay before a delivery due at the same tick', () => {
    let frame = applyAction(prepareTick(createInitialFrame()), 'RESTOCK');
    frame = advanceTick(frame);
    for (let tick = 1; tick < 10; tick++) frame = advanceTick(applyAction(prepareTick(frame), 'WAIT'));
    expect(frame.state.pendingRestock?.dueTick).toBe(10);
    const delayed = prepareTick(frame, { event: { id: 'delay-at-delivery', type: 'supplier-delay', effectiveTick: 10 } });
    expect(delayed.state.rawPortions).toBe(30);
    expect(delayed.state.pendingRestock).toEqual({ quantity: 20, dueTick: 15, delayApplied: true });
    expect(delayed.events.some(e => e.type === 'restock-delivered')).toBe(false);
    expect(frame.state.pendingRestock?.dueTick).toBe(10);
  });

  it('orders injected same-tick arrivals by source and numeric ordinal before FIFO service', () => {
    const customer = (id: string) => ({ id, arrivalTick: 0, patience: 10, deadlineTick: 10 });
    const decision = prepareTick(createInitialFrame(), { arrivals: [
      customer('customer-0-promotion-0'), customer('customer-0-bus-0'),
      customer('customer-0-base-10'), customer('customer-0-base-2'),
    ] });
    expect(decision.state.queue.map(c => c.id)).toEqual([
      'customer-0-base-2', 'customer-0-base-10', 'customer-0-bus-0', 'customer-0-promotion-0',
    ]);
    const committed = applyAction(decision, 'SERVE');
    expect(committed.state.queue.map(c => c.id)).toEqual(['customer-0-promotion-0']);
    expect(committed.state.cashCents).toBe(21500);
    expect(decision.state.queue).toHaveLength(4);
  });

  it('does not serve passively and never admits a customer ID twice', () => {
    const arrivals = [{ id: 'customer-0-base-0', arrivalTick: 0, patience: 10, deadlineTick: 10 }];
    const decision = prepareTick(createInitialFrame(), { arrivals });
    expect(decision.state.totals.served).toBe(0);
    const waiting = applyAction(decision, 'WAIT');
    expect(waiting.state.totals.served).toBe(0);
    expect(waiting.state.queue).toHaveLength(1);
    expect(() => prepareTick(advanceTick(waiting), { arrivals: [{ ...arrivals[0]!, arrivalTick: 1, deadlineTick: 11 }] })).toThrow(/duplicate/i);
  });

  it('rejects an illegal direct action without spending cash or changing inventory', () => {
    const decision = prepareTick(createInitialFrame());
    const before = JSON.stringify(decision);
    expect(() => applyAction(decision, 'SERVE')).toThrow(/illegal/i);
    expect(JSON.stringify(decision)).toBe(before);
  });

  it('settles ready stock and closing customer wait once, with no final arrivals or decisions', () => {
    let frame = createInitialFrame();
    for (let tick = 0; tick < 120; tick++) {
      const arrivals = tick === 118 ? [{ id: 'customer-118-base-0', arrivalTick: 118, patience: 10, deadlineTick: 128 }] : [];
      frame = advanceTick(applyAction(prepareTick(frame, { arrivals }), tick === 114 ? 'COOK' : 'WAIT'));
    }
    expect(frame.boundaryTick).toBe(120);
    expect(() => prepareTick(frame)).toThrow();
    const closed = settle(frame);
    expect(closed.state).toMatchObject({ phase: 'closed', tick: 120, rawPortions: 20, readyBatches: [], queue: [], cooking: null, pendingRestock: null });
    expect(closed.state.totals).toMatchObject({ served: 0, abandoned: 1, wasted: 22, waitMinutes: 2 });
    expect(closed.events.filter(e => e.type === 'closed')).toHaveLength(1);
    expect(() => settle(closed)).toThrow();
    expect(() => applyAction(closed, 'WAIT')).toThrow();
    expect(() => advanceTick(closed)).toThrow();
  });
});

import { decisionInput, projectObservation } from '../packages/simulation/src/observation.js';
import { canonicalState, stateHash } from '../packages/simulation/src/hash.js';
import { episodeMetrics, type Resolution } from '../packages/simulation/src/scoring.js';
import type { EngineEvent } from '../packages/simulation/src/types.js';
import { configurationHash } from '../scripts/config-snapshot.js';

function metricEpisode() {
  let frame = createInitialFrame();
  const resolutions: Resolution[] = [];
  const collect = (events: EngineEvent[]) => {
    for (const event of events) if (event.type === 'customer-resolved') resolutions.push(event);
  };
  for (let tick = 0; tick < 120; tick++) {
    const arrivals = tick < 2 ? [{ id: `customer-${tick}-base-0`, arrivalTick: tick, patience: 3, deadlineTick: tick + 3 }] : [];
    const ready = prepareTick(frame, { arrivals }); collect(ready.events);
    const committed = applyAction(ready, tick === 0 ? 'SERVE' : 'WAIT'); collect(committed.events);
    frame = advanceTick(committed);
  }
  frame = settle(frame); collect(frame.events);
  return { frame, resolutions };
}

describe('independent P2-A observation, hashing and diagnostics review', () => {
  it('builds an allowlisted complete request without copying private/nested state metadata', () => {
    const frame = prepareTick(createInitialFrame(), { arrivals: [{ id: 'customer-0-base-0', arrivalTick: 0, patience: 3, deadlineTick: 3 }] });
    const roundId = '34801eca-7cd6-4c23-a116-8aee7db040ae';
    const clean = decisionInput(frame.state, roundId);
    const polluted = { ...frame.state, seed: 999, schedule: ['secret'], otherPolicy: { cashCents: 9 },
      queue: frame.state.queue.map(c => ({ ...c, privateSeed: 999 })),
      readyBatches: frame.state.readyBatches.map(b => ({ ...b, privateSeed: 999 })),
    };
    expect(decisionInput(polluted, roundId)).toEqual(clean);
    const serialized = JSON.stringify(decisionInput(polluted, roundId));
    expect(serialized).not.toMatch(/secret|privateSeed|otherPolicy|"seed"|schedule/);
    expect(clean.observation.legalActions).toEqual(clean.legalActions);
  });

  it('fails closed for a seed-bearing customer identity that lacks a stable public mapping', () => {
    const frame = prepareTick(createInitialFrame(), { arrivals: [{ id: 'seed-7:customer-0-base-0', arrivalTick: 0, patience: 3, deadlineTick: 3 }] });
    expect(() => projectObservation(frame.state)).toThrow();
  });

  it('projects only the latest five committed own action summaries', () => {
    let frame = createInitialFrame();
    for (let tick = 0; tick < 6; tick++) frame = advanceTick(applyAction(prepareTick(frame), 'WAIT'));
    const ready = prepareTick(frame);
    const history = Array.from({ length: 6 }, (_, tick) => ({ tick, action: 'WAIT' as const, privateSeed: 222 }));
    const observation = projectObservation(ready.state, history);
    expect(observation.recentActions).toEqual([1, 2, 3, 4, 5].map(tick => ({ tick, action: 'WAIT' })));
    expect(JSON.stringify(observation)).not.toContain('privateSeed');
  });

  it('hashes deterministically without operational metadata but includes continuation dedup context', () => {
    const frame = prepareTick(createInitialFrame());
    const scheduleHash = createDemandSchedule(0).hash;
    const input = { frame, scheduleHash, scenario: 'clean' as const, recentActions: [], configurationHash };
    const original = stateHash(input);
    expect(stateHash({ ...input, frame: { ...frame, events: [{ type: 'action-applied', tick: 0, action: 'WAIT' }] } })).toBe(original);
    const metadataInput = { ...input, roundId: 'different-uuid', latencyMs: 999, requestId: 'different-request', timestamp: '2099-01-01' };
    expect(stateHash(metadataInput)).toBe(original);
    expect(stateHash({ ...input, frame: { ...frame, seenCustomerIds: ['already-resolved-customer'] } })).not.toBe(original);
    expect(stateHash({ ...input, recentActions: [{ tick: 0, action: 'WAIT' as const }] })).not.toBe(original);
    expect(() => canonicalState({ illegal: 0.5 })).toThrow();
    expect(() => canonicalState({ illegal: -0 })).toThrow();
    expect(canonicalState({ b: 1, a: 2 })).toBe(canonicalState({ a: 2, b: 1 }));
  });

  it('derives diagnostic waits/satisfaction from actual customer resolution events', () => {
    const { frame, resolutions } = metricEpisode();
    expect(resolutions.map(r => ({ outcome: r.outcome, wait: r.waitMinutes }))).toEqual([
      { outcome: 'served', wait: 0 }, { outcome: 'patience_expired', wait: 3 },
    ]);
    expect(episodeMetrics(frame.state, resolutions, 0)).toMatchObject({
      served: 1, abandoned: 1, wasted: 11, waitMinutes: 3,
      meanWaitMinutes: 1.5, servedMeanWaitMinutes: 0, satisfaction: 50, fillRate: 0.5,
      profitCents: -1900, utilityPoints: -2565, stockoutTicks: 0,
    });
  });

  it('rejects incomplete diagnostic projections rather than inventing missing outcomes', () => {
    const { frame, resolutions } = metricEpisode();
    expect(() => episodeMetrics(frame.state, resolutions.slice(1), 0)).toThrow();
    expect(() => episodeMetrics(frame.state, [resolutions[0]!, resolutions[0]!], 0)).toThrow();
  });

  it('rejects negative or inconsistent individual waits even if their aggregate matches state', () => {
    const { frame, resolutions } = metricEpisode();
    const corrupted: Resolution[] = [
      { ...resolutions[0]!, waitMinutes: -1 },
      { ...resolutions[1]!, waitMinutes: 4 },
    ];
    expect(() => episodeMetrics(frame.state, corrupted, 0)).toThrow();
  });
});

import { runEpisode } from '../scripts/offline-episode.js';

describe('independent P2-A full offline episode review', () => {
  it('keeps operational identity/metadata out of simulator results and performs no fetch', () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Unexpected network call'); });
    try {
      const a = runEpisode({ seed: 4, scenario: 'supplier-delay', roundId: '34801eca-7cd6-4c23-a116-8aee7db040ae', metadata: { timestamp: 1, spectators: 1, mode: 'cinematic' } });
      const b = runEpisode({ seed: 4, scenario: 'supplier-delay', roundId: '09f29c34-a963-4ff3-9147-65a3fa9dfdb6', metadata: { timestamp: 9999, spectators: 100, mode: 'analytical' } });
      expect(a.completed).toBe(true); expect(b.completed).toBe(true);
      expect(a.trace).toHaveLength(120); expect(a.finalState.tick).toBe(120);
      expect(a.finalHash).toBe(b.finalHash); expect(a.traceHash).toBe(b.traceHash);
      expect(a.trace.map(t => t.decision.appliedAction)).toEqual(b.trace.map(t => t.decision.appliedAction));
      expect(a.metrics).toEqual(b.metrics);
      expect(fetch).not.toHaveBeenCalled();
      expect(a.networkCalls).toBe(0); expect(b.networkCalls).toBe(0);
      expect(a.trace.every(t => t.decision.mode === 'offline')).toBe(true);
    } finally { fetch.mockRestore(); }
  });

  it('rejects held-out and static evaluation seeds in the development episode runner', () => {
    expect(() => runEpisode({ seed: 1000 })).toThrow(/0.99/);
    expect(() => runEpisode({ seed: 3000 })).toThrow(/0.99/);
    expect(() => runEpisode({ seed: -1 })).toThrow();
  });

  it('reports mock provenance explicitly for a mixed-action development run', () => {
    const mixed = runEpisode({ seed: 2, scenario: 'bus', policy: 'mixed' });
    expect(mixed.trace.every(t => t.decision.origin === 'mock' || t.decision.origin === 'forced_wait')).toBe(true);
    expect(mixed.mode).toBe('offline'); expect(mixed.policy).toBe('mixed');
    expect(mixed.finalState.phase).toBe('closed');
    expect(mixed.finalState.queue).toEqual([]);
    expect(mixed.finalState.cooking).toBeNull(); expect(mixed.finalState.pendingRestock).toBeNull();
    expect(mixed.networkCalls).toBe(0);
  });

  it.each([-1, 121, 0.5, -0])('rejects noncanonical/impossible stockout count %s', stockouts => {
    const { frame, resolutions } = metricEpisode();
    expect(() => episodeMetrics(frame.state, resolutions, stockouts)).toThrow();
  });
});
