import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { recordEpisode } from '../packages/replay/src/record.js';
import { replayArchive } from '../packages/replay/src/replay.js';
import { scoreState } from '../packages/simulation/src/scoring.js';
import type { EngineEvent } from '../packages/simulation/src/types.js';
import type { Observation, SimulatorState } from '../packages/shared/src/index.js';
import type { EpisodeArchive, EpisodeTurn } from '../packages/replay/src/schema.js';
import {
  DEMO_COMPETITORS, DEMO_SCENARIOS,
  type DemoData, type DemoCustomerActivity, type DemoEffectActivity, type DemoObservationSummary, type DemoPolicySnapshot,
  type DemoScenario, type DemoScenarioId, type DemoTerminal, type DemoTurn,
} from '../apps/web/lib/demo.js';

function observationSummary(observation: Observation): DemoObservationSummary {
  const head = observation.queue[0];
  return {
    tick: observation.tick, remainingMinutes: observation.remainingMinutes, cashCents: observation.cashCents,
    queueCount: observation.queue.length, readyPortions: observation.readyBatches.reduce((sum, batch) => sum + batch.quantity, 0),
    rawPortions: observation.rawPortions,
    oldestWaitMinutes: head ? observation.tick - head.arrivalTick : 0,
    headDeadlineInMinutes: head ? head.deadlineTick - observation.tick : null,
    cookingDueInMinutes: observation.cooking ? observation.cooking.dueTick - observation.tick : null,
    restockDueInMinutes: observation.pendingRestock ? observation.pendingRestock.dueTick - observation.tick : null,
    promotionActive: !!observation.promotion && observation.promotion.startsAt <= observation.tick && observation.promotion.endsAt >= observation.tick,
    effects: observation.effects.map(effect => effect.type), legalActions: [...observation.legalActions],
  };
}
function publicEventSummaries(events: readonly EngineEvent[]): string[] {
  const summaries: string[] = [];
  for (const event of events) {
    if (event.type === 'effect-applied') summaries.push(event.effectType === 'bus' ? 'A bus arrival brought six extra customers.' : event.effectType === 'rain' ? 'Rain began, reducing base arrivals.' : 'A supplier delay began.');
    else if (event.type === 'cooking-completed') summaries.push(`${event.quantity} freshly cooked portions became ready.`);
    else if (event.type === 'restock-delivered') summaries.push(`${event.quantity} raw portions arrived.`);
  }
  const served = events.filter(event => event.type === 'customer-resolved' && event.outcome === 'served').length;
  const abandoned = events.filter(event => event.type === 'customer-resolved' && event.outcome !== 'served').length;
  const wasted = events.reduce((sum, event) => sum + (event.type === 'ready-wasted' ? event.quantity : 0), 0);
  if (served) summaries.push(`${served} customer${served === 1 ? '' : 's'} served.`);
  if (abandoned) summaries.push(`${abandoned} customer${abandoned === 1 ? '' : 's'} left unserved.`);
  if (wasted) summaries.push(`${wasted} ready portion${wasted === 1 ? '' : 's'} discarded.`);
  if (events.some(event => event.type === 'closed')) summaries.push('Lunch service closed; settlement is final.');
  return summaries;
}
function consequence(turn: EpisodeTurn, state: SimulatorState, arrivals: number): string {
  const events = [...turn.preparedEvents, ...turn.committedEvents];
  const lines: string[] = [];
  if (arrivals) lines.push(`${arrivals} customer${arrivals === 1 ? '' : 's'} arrived.`);
  if (turn.appliedAction === 'COOK') lines.push(`Started cooking ${state.cooking!.quantity} portions.`);
  if (turn.appliedAction === 'RESTOCK') lines.push(`Ordered ${state.pendingRestock!.quantity} raw portions.`);
  if (turn.appliedAction === 'PROMOTE') lines.push('Started a promotion for the next ten minutes.');
  lines.push(...publicEventSummaries(events));
  if (!lines.length) lines.push(turn.decision.origin === 'forced_wait' ? 'WAIT was the only legal action; no controller was called.' : 'Waited while background timers continued.');
  return lines.join(' ');
}
function policySnapshot(state: SimulatorState, turn: EpisodeTurn | null, message: string): DemoPolicySnapshot {
  const score = scoreState(state);
  return {
    id: 'rules', decisionSource: 'rules-baseline', action: turn?.appliedAction ?? null,
    validation: turn ? turn.decision.origin === 'forced_wait' ? 'forced-wait' : 'valid-local-rules' : 'settled',
    rulePriority: turn?.decision.rulePriority ?? null,
    profitCents: score.profitCents, utilityPoints: score.utilityPoints, provisional: score.provisional,
    queueCount: state.queue.length, readyPortions: state.readyBatches.reduce((sum, batch) => sum + batch.quantity, 0), rawPortions: state.rawPortions,
    cookingPortions: state.cooking?.quantity ?? 0, pendingRestockPortions: state.pendingRestock?.quantity ?? 0,
    served: state.totals.served, abandoned: state.totals.abandoned, wasted: state.totals.wasted, waitMinutes: state.totals.waitMinutes,
    effects: state.effects.map(effect => effect.type), observationSummary: turn ? observationSummary(turn.observation) : null,
    consequence: message,
  };
}
function mirrorStalls(baseline: DemoPolicySnapshot): DemoTurn['stalls'] {
  return DEMO_COMPETITORS.map(competitor => ({ ...structuredClone(baseline), id: competitor.id, decisionSource: 'rules-demo-mirror' as const })) as DemoTurn['stalls'];
}
/** Only current public quantities/poses cross this projection, never private customer IDs. */
function customerActivity(state: SimulatorState, events: readonly EngineEvent[], tick: number): DemoCustomerActivity {
  return {
    queuePoses: state.queue.slice(0, 3).map(customer => customer.arrivalTick === tick ? 'walk' : customer.deadlineTick - tick <= 1 ? 'impatient' : 'wait'),
    received: events.filter(event => event.type === 'customer-resolved' && event.outcome === 'served').length,
    departed: events.filter(event => event.type === 'customer-resolved' && event.outcome !== 'served').length,
  };
}
/** Delivery is an engine fact, independent of action names or human-readable summaries. */
function effectActivity(events: readonly EngineEvent[]): DemoEffectActivity {
  return { delivered: events.some(event => event.type === 'restock-delivered') };
}
function scenarioData(id: DemoScenarioId): DemoScenario {
  // Private seed and archive never cross the public projection below.
  const archive = recordEpisode({ seed: 0, scenario: id, policy: 'rules', snapshotEvery: 1 });
  const replay = replayArchive(archive, { configurationHash: archive.header.configurationHash });
  assert.equal(replay.networkCalls, 0);
  assert.deepEqual(replay.score, archive.terminal.score);
  const snapshots = new Map(archive.snapshots.map(snapshot => [snapshot.sequence, snapshot]));
  let previousArrivals = 0;
  const turns: DemoTurn[] = archive.turns.map(turn => {
    assert.equal(turn.decision.mode, 'offline');
    assert.ok(turn.decision.origin === 'rules' || turn.decision.origin === 'forced_wait');
    const snapshot = snapshots.get(turn.sequence);
    assert.ok(snapshot, `Missing committed snapshot for turn ${turn.tick}`);
    const arrivals = turn.observation.totals.arrivals - previousArrivals;
    previousArrivals = snapshot.frame.state.totals.arrivals;
    const baseline = policySnapshot(snapshot.frame.state, turn, consequence(turn, snapshot.frame.state, arrivals));
    return {
      tick: turn.tick, minute: turn.tick + 1, phase: 'committed',
      customerActivity: customerActivity(snapshot.frame.state, [...turn.preparedEvents, ...turn.committedEvents], turn.tick),
      effectActivity: effectActivity([...turn.preparedEvents, ...turn.committedEvents]),
      stalls: mirrorStalls(baseline), rulesBaseline: baseline,
      eventSummary: publicEventSummaries([...turn.preparedEvents, ...turn.committedEvents]),
    };
  });
  const terminalSummary = publicEventSummaries(archive.terminal.events);
  const terminalBaseline = policySnapshot(archive.terminal.frame.state, null, terminalSummary.join(' '));
  const terminal: DemoTerminal = { effectActivity: effectActivity(archive.terminal.events), customerActivity: customerActivity(archive.terminal.frame.state, archive.terminal.events, 120), tick: 120, minute: 120, phase: 'closed', stalls: mirrorStalls(terminalBaseline), rulesBaseline: terminalBaseline, eventSummary: terminalSummary };
  const info = DEMO_SCENARIOS.find(scenario => scenario.id === id)!;
  return { id, title: info.title, description: info.description, turns, terminal };
}
/** Public fixture only. It contains no model-authored actions or measured model comparison. */
export function generateWebDemo(): DemoData {
  const data: DemoData = {
    schemaVersion: 'web-demo-3', classification: 'offline-rules-demo',
    disclosure: 'Offline rules demo. Jev, Zoom and Zoom Pro views mirror the same recorded local rules run. No live model inference or model-performance comparison is shown. The rules baseline is listed separately.',
    currency: 'SGD', baselineVersion: 'rules-1', simulationVersion: 'poc-1', scorerVersion: 'utility-1',
    modelInferencePerformed: false, benchmarkResultsIncluded: false,
    competitors: structuredClone(DEMO_COMPETITORS) as DemoData['competitors'],
    scenarios: DEMO_SCENARIOS.map(scenario => scenarioData(scenario.id)) as DemoData['scenarios'],
    scoreDefinitions: {
      profit: 'Game profit in Singapore cents; retained raw stock is valued at ingredient cost.',
      utility: 'utility-1 points: profit cents minus abandonment, all resolved wait and prepared-food waste penalties.',
      provisional: 'Turn scores are provisional marked-to-cost values using resolved-customer waits. Tick-120 settlement is final.',
    },
  };
  assertPublicDemo(data);
  return data;
}
export function assertPublicDemo(data: DemoData): void {
  assert.equal(data.schemaVersion, 'web-demo-3');
  assert.equal(data.classification, 'offline-rules-demo');
  assert.equal(data.modelInferencePerformed, false); assert.equal(data.benchmarkResultsIncluded, false);
  assert.deepEqual(data.competitors.map(competitor => competitor.id), ['jev', 'zoom', 'zoom-pro']);
  assert.deepEqual(data.scenarios.map(scenario => scenario.id), ['clean', 'bus', 'rain', 'supplier-delay']);
  const forbiddenKeys = new Set(['seed', 'schedule', 'scheduleHash', 'privateToPublicIds', 'requestId', 'roundId', 'input', 'latencyMs', 'modelVersion', 'probabilities', 'confidence', 'rank']);
  function check(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(check); return; }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert.ok(!forbiddenKeys.has(key), `Private or misleading public field: ${key}`); check(child); }
    else if (typeof value === 'string') assert.ok(!value.includes('seed-'), 'Private seed-bearing identity leaked');
  }
  check(data);
  for (const scenario of data.scenarios) {
    assert.equal(scenario.turns.length, 120);
    for (const [tick, turn] of scenario.turns.entries()) {
      assert.equal(typeof turn.effectActivity.delivered, 'boolean');
      assert.equal(turn.customerActivity.queuePoses.length, Math.min(3, turn.rulesBaseline.queueCount));
      for (const pose of turn.customerActivity.queuePoses) assert.ok(['walk', 'wait', 'impatient'].includes(pose));
      const previous = tick > 0 ? scenario.turns[tick - 1]!.rulesBaseline : { served: 0, abandoned: 0 };
      assert.equal(turn.customerActivity.received, turn.rulesBaseline.served - previous.served);
      assert.equal(turn.customerActivity.departed, turn.rulesBaseline.abandoned - previous.abandoned);
      assert.equal(turn.tick, tick); assert.equal(turn.minute, tick + 1); assert.equal(turn.rulesBaseline.provisional, true);
      assert.equal(turn.stalls.length, 3); assert.equal(turn.rulesBaseline.id, 'rules'); assert.equal(turn.rulesBaseline.decisionSource, 'rules-baseline');
      for (const [index, stall] of turn.stalls.entries()) {
        assert.equal(stall.id, data.competitors[index]!.id); assert.equal(stall.decisionSource, 'rules-demo-mirror');
        const { id: _id, decisionSource: _source, ...copy } = stall;
        const { id: _baselineId, decisionSource: _baselineSource, ...baselineCopy } = turn.rulesBaseline;
        assert.deepEqual(copy, baselineCopy);
        assert.ok(stall.observationSummary!.legalActions.includes(stall.action!));
      }
    }
    assert.deepEqual(scenario.terminal.customerActivity.queuePoses, []);
    assert.equal(typeof scenario.terminal.effectActivity.delivered, 'boolean');
    assert.equal(scenario.terminal.customerActivity.received, 0);
    assert.equal(scenario.terminal.customerActivity.departed, scenario.terminal.rulesBaseline.abandoned - scenario.turns[119]!.rulesBaseline.abandoned);
    assert.equal(scenario.terminal.rulesBaseline.provisional, false); assert.equal(scenario.terminal.rulesBaseline.action, null);
    assert.equal(scenario.terminal.rulesBaseline.queueCount, 0); assert.equal(scenario.terminal.rulesBaseline.readyPortions, 0);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = fileURLToPath(new URL('../apps/web/public/demo.json', import.meta.url));
  const text = `${JSON.stringify(generateWebDemo())}\n`;
  if (process.argv.includes('--check')) {
    assert.equal(readFileSync(destination, 'utf8'), text, 'Public demo differs from deterministic regeneration');
    console.log('Public rules demo verified: four scenarios, 480 turns, zero model calls.');
  } else {
    writeFileSync(destination, text);
    console.log(`Generated public rules demo: four scenarios, 480 turns, ${Buffer.byteLength(text)} bytes, zero model calls.`);
  }
}
