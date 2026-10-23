import { z } from 'zod';
import { ACTIONS, ActionSchema, SimulatorStateSchema, type SimulatorState } from '../../shared/src/index.js';
import { advanceTick, applyAction, assertFrame, prepareTick, settle } from '../../simulation/src/engine.js';
import { getLegalActions } from '../../simulation/src/legality.js';
import { scoreState } from '../../simulation/src/scoring.js';
import type { Action, Customer, EngineFrame } from '../../simulation/src/types.js';
import { add, compare, multiply, rational, serializeRational, subtract, SerializedRationalSchema, deserializeRational, type Rational } from './rational.js';

export const ORACLE_SOLVER_VERSION = 'tiny-oracle-1' as const;
export const DEFAULT_ORACLE_LIMITS = Object.freeze({ maxStates: 20_000, maxBranches: 20_000 });
/** No future exogenous event schedule or seed is supplied to this finite-horizon task. */
export const OracleTaskSchema = z.object({
  initialState: SimulatorStateSchema,
  horizonEndTick: z.literal(120),
  futureEvents: z.array(z.never()).length(0),
}).strict().superRefine((task, ctx) => {
  if (task.initialState.phase !== 'decision' || task.initialState.tick < 117 || task.initialState.tick > 119) {
    ctx.addIssue({ code: 'custom', message: 'static-task-1 starts at a prepared tick 117, 118 or 119' });
  }
});
export type OracleTask = z.infer<typeof OracleTaskSchema>;
export const ExactOracleResultSchema = z.object({
  solverVersion: z.literal(ORACLE_SOLVER_VERSION), status: z.literal('exact'),
  optimalActions: z.array(ActionSchema).min(1).max(5),
  actionValues: z.array(z.object({ action: ActionSchema, expectedFinalUtility: SerializedRationalSchema, expectedRemainingUtility: SerializedRationalSchema }).strict()).min(1).max(5),
  exploredStates: z.number().int().safe().positive(), exploredBranches: z.number().int().safe().nonnegative(),
}).strict().superRefine((result, ctx) => {
  const actions = result.actionValues.map(entry => entry.action);
  if (new Set(actions).size !== actions.length || actions.some((action, i) => i > 0 && ACTIONS.indexOf(action) <= ACTIONS.indexOf(actions[i - 1]!))) ctx.addIssue({ code: 'custom', message: 'Oracle action values must be unique and in canonical action order' });
  if (new Set(actions).size === actions.length && result.actionValues.every(entry => SerializedRationalSchema.safeParse(entry.expectedFinalUtility).success)) {
    const expected = maximizingActions(result.actionValues.map(entry => ({ action: entry.action, value: deserializeRational(entry.expectedFinalUtility) })));
    if (JSON.stringify(result.optimalActions) !== JSON.stringify(expected)) ctx.addIssue({ code: 'custom', message: 'Oracle label must include every exact utility maximizer' });
  }
});
export type ExactOracleResult = z.infer<typeof ExactOracleResultSchema>;
export interface OracleLimits { maxStates: number; maxBranches: number }
export class OracleLimitError extends Error {
  readonly code = 'ORACLE_LIMIT_EXCEEDED';
  constructor(readonly exploredStates: number, readonly exploredBranches: number, readonly limitKind: 'states' | 'branches', readonly limits: OracleLimits) {
    super(`Exact oracle ${limitKind} limit exceeded (${exploredStates} states, ${exploredBranches} branches)`);
    this.name = 'OracleLimitError';
  }
}
const DRAW_DENOMINATOR = 4_294_967_296n;
const NINETY_PERCENT_CUTOFF = (9n * DRAW_DENOMINATOR + 9n) / 10n;
/** Exact count masses induced by r/2^32 < 0.5 and r/2^32 < 0.9. */
export const OFF_PEAK_BASE_COUNT_PROBABILITIES = Object.freeze([
  rational(DRAW_DENOMINATOR / 2n, DRAW_DENOMINATOR),
  rational(NINETY_PERCENT_CUTOFF - DRAW_DENOMINATOR / 2n, DRAW_DENOMINATOR),
  rational(DRAW_DENOMINATOR - NINETY_PERCENT_CUTOFF, DRAW_DENOMINATOR),
]);
export const ORACLE_DISTRIBUTION = Object.freeze({
  version: 'static-task-1-independent-demand-1',
  baseCount: Object.freeze(OFF_PEAK_BASE_COUNT_PROBABILITIES.map(value => Object.freeze(serializeRational(value)))),
  patienceEach: Object.freeze(serializeRational(rational(1, 8))),
  promotionExtra: Object.freeze(serializeRational(rational(1, 2))),
  rainKeep: Object.freeze(serializeRational(rational(1, 2))),
  hiddenDraws: 'independent finite-32-bit draw distributions; no realized seed schedule',
});
export interface FutureArrivalBranch { readonly arrivals: readonly Customer[]; readonly probability: Rational }
interface ArrivalOptions { promotionActive?: boolean; rainActive?: boolean }

/** Marginalize unobserved patience for rain-rejected customers exactly, then merge identical realized inputs. */
export function enumerateFutureArrivals(tick: number, options: ArrivalOptions = {}): readonly FutureArrivalBranch[] {
  if (!Number.isSafeInteger(tick) || tick < 118 || tick > 119) throw new Error('This tiny task enumerates only future ticks 118 and 119');
  const byInput = new Map<string, FutureArrivalBranch>();
  for (let baseCount = 0; baseCount <= 2; baseCount++) {
    let branches: FutureArrivalBranch[] = [{ arrivals: [], probability: OFF_PEAK_BASE_COUNT_PROBABILITIES[baseCount]! }];
    for (let ordinal = 0; ordinal < baseCount; ordinal++) {
      const next: FutureArrivalBranch[] = [];
      for (const branch of branches) {
        if (options.rainActive) next.push({ arrivals: branch.arrivals, probability: multiply(branch.probability, rational(1, 2)) });
        for (let patience = 3; patience <= 10; patience++) {
          const customer: Customer = { id: `customer-${tick}-base-${ordinal}`, arrivalTick: tick, patience, deadlineTick: tick + patience };
          next.push({ arrivals: [...branch.arrivals, customer], probability: multiply(branch.probability, rational(1, options.rainActive ? 16 : 8)) });
        }
      }
      branches = next;
    }
    if (options.promotionActive) {
      const next: FutureArrivalBranch[] = [];
      for (const branch of branches) {
        next.push({ arrivals: branch.arrivals, probability: multiply(branch.probability, rational(1, 2)) });
        for (let patience = 3; patience <= 10; patience++) {
          const customer: Customer = { id: `customer-${tick}-promotion-0`, arrivalTick: tick, patience, deadlineTick: tick + patience };
          next.push({ arrivals: [...branch.arrivals, customer], probability: multiply(branch.probability, rational(1, 16)) });
        }
      }
      branches = next;
    }
    for (const branch of branches) {
      const key = JSON.stringify(branch.arrivals), previous = byInput.get(key);
      byInput.set(key, previous ? { arrivals: previous.arrivals, probability: add(previous.probability, branch.probability) } : branch);
    }
  }
  return [...byInput.values()];
}

/** Exact comparison helper retains every equal maximizer, never a floating-point epsilon. */
export function maximizingActions(values: readonly { action: Action; value: Rational }[]): Action[] {
  if (values.length === 0 || new Set(values.map(entry => entry.action)).size !== values.length) throw new Error('Expected unique action values');
  let best = values[0]!.value;
  for (const entry of values.slice(1)) if (compare(entry.value, best) > 0) best = entry.value;
  return values.filter(entry => compare(entry.value, best) === 0).map(entry => entry.action);
}
function canonicalState(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalState).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalState(record[key])}`).join(',')}}`;
}
function startingFrame(state: SimulatorState): EngineFrame {
  const frame: EngineFrame = { stage: 'decision', boundaryTick: state.tick, state,
    ledger: { openingCashCents: 20000, openingPortions: 42 }, appliedEvents: [], seenCustomerIds: state.queue.map(customer => customer.id), events: [] };
  assertFrame(frame);
  return frame;
}
/** Exact adaptive legal control through closing. Limits reject the task; no partial result or approximation is returned. */
export function solveStaticTask(input: OracleTask, options: Partial<OracleLimits> = {}): ExactOracleResult {
  const task = OracleTaskSchema.parse(input);
  const limits: OracleLimits = { ...DEFAULT_ORACLE_LIMITS, ...options };
  if (!Object.keys(options).every(key => key === 'maxStates' || key === 'maxBranches') || Object.values(limits).some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error('Oracle limits must be positive safe integers');
  let exploredStates = 1, exploredBranches = 0;
  const memo = new Map<string, Rational>();
  function check(kind: 'states' | 'branches'): void {
    if (exploredStates > limits.maxStates || exploredBranches > limits.maxBranches) throw new OracleLimitError(exploredStates, exploredBranches, kind, limits);
  }
  function valueAfterAction(frame: EngineFrame, action: Action): Rational {
    const committed = applyAction(frame, action), before = advanceTick(committed);
    if (before.boundaryTick === 120) {
      const utility = scoreState(settle(before).state).utilityPoints;
      if (!Number.isSafeInteger(utility)) throw new Error('Terminal utility must be a safe integer');
      return rational(utility);
    }
    const tick = before.boundaryTick;
    const promotionActive = before.state.promotion !== null && before.state.promotion.startsAt <= tick && before.state.promotion.endsAt >= tick;
    const rainActive = before.state.effects.some(effect => effect.type === 'rain' && effect.startsAt <= tick && effect.endsAt >= tick);
    let expectation = rational(0);
    for (const branch of enumerateFutureArrivals(tick, { promotionActive, rainActive })) {
      exploredBranches++; check('branches');
      const next = prepareTick(before, { arrivals: branch.arrivals });
      expectation = add(expectation, multiply(branch.probability, optimalValue(next)));
    }
    return expectation;
  }
  function optimalValue(frame: EngineFrame): Rational {
    const key = canonicalState(frame.state), cached = memo.get(key);
    if (cached !== undefined) return cached;
    exploredStates++; check('states');
    const values = getLegalActions(frame.state).map(action => valueAfterAction(frame, action));
    let best = values[0]!;
    for (const value of values.slice(1)) if (compare(value, best) > 0) best = value;
    memo.set(key, best);
    return best;
  }
  const initial = startingFrame(task.initialState);
  const values = getLegalActions(initial.state).map(action => ({ action, value: valueAfterAction(initial, action) }));
  const sunkUtility = rational(scoreState(initial.state).utilityPoints);
  return ExactOracleResultSchema.parse({
    solverVersion: ORACLE_SOLVER_VERSION, status: 'exact', optimalActions: maximizingActions(values),
    actionValues: values.map(({ action, value }) => ({ action, expectedFinalUtility: serializeRational(value), expectedRemainingUtility: serializeRational(subtract(value, sunkUtility)) })),
    exploredStates, exploredBranches,
  });
}
