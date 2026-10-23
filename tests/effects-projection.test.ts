import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { createInitialFrame, prepareTick, applyAction, advanceTick, settle } from '../packages/simulation/src/engine.js';
import { createDemandSchedule, arrivalsAt, toEngineArrival, eventAt } from '../packages/simulation/src/demand.js';
import { getLegalActions } from '../packages/simulation/src/legality.js';
import { chooseRules } from '../packages/decisions/src/rules.js';
import { assertPublicDemo } from '../scripts/generate-web-demo.js';
import { projectEffects, type EffectObservation } from '../apps/web/lib/effects.js';
import type { DemoData } from '../apps/web/lib/demo.js';

const data = JSON.parse(readFileSync('apps/web/public/demo.json', 'utf8')) as DemoData;
const quiet: EffectObservation = {
  cooking: false, received: 0, queue: 0, ready: 0, raw: 0,
  settled: false, delivered: false, effects: [],
};
const active: EffectObservation = {
  cooking: true, received: 3, queue: 4, ready: 0, raw: 0,
  settled: false, delivered: true, effects: ['bus', 'rain', 'supplier-delay'],
};
const clips = (state: EffectObservation) => projectEffects(state, 0, false).map(effect => effect.clip);

describe('committed public effect evidence', () => {
  it('reconciles every delivery flag with a separate direct engine execution', () => {
    expect(data.schemaVersion).toBe('web-demo-3');
    let deliveries = 0, ordersBeforeDelivery = 0;
    for (const scenario of data.scenarios) {
      const schedule = createDemandSchedule(0, scenario.id);
      let frame = createInitialFrame();
      for (let tick = 0; tick < 120; tick++) {
        const promotion = frame.state.promotion;
        const promotionActive = !!promotion && promotion.startsAt <= tick && promotion.endsAt >= tick;
        const event = eventAt(schedule, tick);
        const arrivals = arrivalsAt(schedule, tick, promotionActive).map(toEngineArrival);
        const prepared = prepareTick(frame, event ? { arrivals, event } : { arrivals });
        const action = chooseRules(prepared.state, getLegalActions(prepared.state)).action;
        const committed = applyAction(prepared, action);
        const deliveryEvents = [...prepared.events, ...committed.events].filter(item => item.type === 'restock-delivered');
        const turn = scenario.turns[tick]!;
        expect(turn.effectActivity).toEqual({ delivered: deliveryEvents.length > 0 });
        expect(turn.rulesBaseline.action).toBe(action);
        expect(turn.rulesBaseline.rawPortions).toBe(committed.state.rawPortions);
        expect(turn.rulesBaseline.served).toBe(committed.state.totals.served);
        if (deliveryEvents.length) {
          deliveries++;
          expect(deliveryEvents.every(item => item.tick === tick && item.quantity > 0)).toBe(true);
          expect(prepared.state.pendingRestock).toBeNull();
        }
        if (action === 'RESTOCK' && deliveryEvents.length === 0) ordersBeforeDelivery++;
        frame = advanceTick(committed);
      }
      const terminal = settle(frame);
      expect(scenario.terminal.effectActivity).toEqual({ delivered: terminal.events.some(item => item.type === 'restock-delivered') });
    }
    expect(deliveries).toBeGreaterThan(0);
    expect(ordersBeforeDelivery, 'An order must not be labelled as a completed delivery').toBeGreaterThan(0);
  });

  it('validates the new public delivery field on turns and terminal settlement', () => {
    expect(() => assertPublicDemo(data)).not.toThrow();
    const invalidTurn = structuredClone(data);
    (invalidTurn.scenarios[0].turns[0]!.effectActivity as { delivered: unknown }).delivered = 'true';
    expect(() => assertPublicDemo(invalidTurn)).toThrow();
    const invalidTerminal = structuredClone(data);
    (invalidTerminal.scenarios[0].terminal.effectActivity as { delivered: unknown }).delivered = undefined;
    expect(() => assertPublicDemo(invalidTerminal)).toThrow();
  });
});

describe('effect presentation projection', () => {
  it('requires committed evidence for each service, delivery and scenario cue', () => {
    expect(clips(quiet)).toEqual([]);
    expect(clips({ ...quiet, cooking: true })).toEqual(['steam']);
    expect(clips({ ...quiet, received: 1 })).toEqual(['service']);
    expect(clips({ ...quiet, delivered: true })).toEqual(['delivery']);
    for (const effect of ['bus', 'rain', 'supplier-delay'] as const) {
      expect(clips({ ...quiet, effects: [effect] })).toEqual([effect]);
    }
    expect(clips(active)).toEqual(['steam', 'service', 'shortage', 'delivery', 'bus', 'rain', 'supplier-delay']);
  });

  it('only marks a shortage for a nonempty queue with no ready or raw portions', () => {
    expect(clips({ ...quiet, queue: 1 })).toEqual(['shortage']);
    expect(clips({ ...quiet, queue: 1, ready: 1 })).toEqual([]);
    expect(clips({ ...quiet, queue: 1, raw: 1 })).toEqual([]);
    expect(clips({ ...quiet, ready: 0, raw: 0 })).toEqual([]);
    expect(projectEffects({ ...active, settled: true }, 0, false)).toEqual([]);
  });

  it('hides steam and freezes meaningful cues at their first frames with reduced motion', () => {
    const expected = ['service', 'shortage', 'delivery', 'bus', 'rain', 'supplier-delay'].map(clip => ({ clip, frame: 0 }));
    expect(projectEffects(active, 600, true)).toEqual(expected);
    expect(projectEffects(active, 99999, true)).toEqual(expected);
    expect(projectEffects({ ...active, settled: true }, 99999, true)).toEqual([]);
  });

  it('reconstructs effects on seeking without retaining a prior state or mutating evidence', () => {
    const input = structuredClone(active), before = structuredClone(input);
    Object.freeze(input.effects); Object.freeze(input);
    const first = projectEffects(input, 0, false);
    expect(first.every(effect => effect.frame === 0)).toBe(true);
    expect(projectEffects(input, 350, false).some(effect => effect.frame > 0)).toBe(true);
    projectEffects(quiet, 9000, false);
    projectEffects({ ...active, settled: true }, 9000, false);
    expect(projectEffects(input, 0, false)).toEqual(first);
    expect(input).toEqual(before);
  });
});
