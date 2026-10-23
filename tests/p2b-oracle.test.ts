import { describe, expect, it } from 'vitest';
import { SimulatorStateSchema, type SimulatorState } from '../packages/shared/src/index.js';
import { rational, add, subtract, multiply, compare, serializeRational, deserializeRational, SerializedRationalSchema } from '../packages/benchmark/src/rational.js';
import {
  solveStaticTask, maximizingActions, enumerateFutureArrivals, OFF_PEAK_BASE_COUNT_PROBABILITIES,
  OracleLimitError, OracleTaskSchema, ExactOracleResultSchema,
} from '../packages/benchmark/src/oracle.js';

function emptyPrepared(tick: 117 | 118 | 119): SimulatorState {
  return SimulatorStateSchema.parse({
    tick, phase: 'decision', cashCents: 20000, rawPortions: 30, readyBatches: [], cooking: null, pendingRestock: null,
    promotion: null, promotionEligibleAt: 0, queue: [], effects: [],
    totals: { served: 0, abandoned: 0, wasted: 12, waitMinutes: 0, arrivals: 0, purchasedPortions: 0, restockOrders: 0, promotions: 0 },
  });
}
const task = (state: SimulatorState) => ({ initialState: state, horizonEndTick: 120 as const, futureEvents: [] as never[] });

describe('exact rational arithmetic', () => {
  it('normalizes sign and zero, and compares equivalent fractions without floating arithmetic', () => {
    expect(serializeRational(rational(2n, -6n))).toEqual({ numerator: '-1', denominator: '3' });
    expect(serializeRational(rational(0n, 99n))).toEqual({ numerator: '0', denominator: '1' });
    expect(compare(rational(1, 3), rational(2, 6))).toBe(0);
    expect(serializeRational(add(rational(1, 3), rational(1, 6)))).toEqual({ numerator: '1', denominator: '2' });
    expect(serializeRational(subtract(rational(1, 3), rational(1, 6)))).toEqual({ numerator: '1', denominator: '6' });
    expect(serializeRational(multiply(rational(2, 3), rational(9, 4)))).toEqual({ numerator: '3', denominator: '2' });
    expect(() => rational(1, 0)).toThrow();
    expect(() => rational(1.5)).toThrow();
  });
  it('roundtrips canonical string fractions and rejects noncanonical ones', () => {
    expect(serializeRational(deserializeRational({ numerator: '-3', denominator: '2' }))).toEqual({ numerator: '-3', denominator: '2' });
    expect(SerializedRationalSchema.safeParse({ numerator: '2', denominator: '6' }).success).toBe(false);
    expect(SerializedRationalSchema.safeParse({ numerator: '-0', denominator: '1' }).success).toBe(false);
    expect(SerializedRationalSchema.safeParse({ numerator: '0', denominator: '2' }).success).toBe(false);
    expect(SerializedRationalSchema.safeParse({ numerator: 'x', denominator: '0' }).success).toBe(false);
  });
  it('retains every exact first-action tie and distinguishes tiny differences', () => {
    expect(maximizingActions([{ action: 'SERVE', value: rational(1, 3) }, { action: 'WAIT', value: rational(2, 6) }])).toEqual(['SERVE', 'WAIT']);
    expect(maximizingActions([{ action: 'SERVE', value: rational(1, 3) }, { action: 'WAIT', value: rational(1_000_000_000_001n, 3_000_000_000_000n) }])).toEqual(['WAIT']);
  });
});

describe('exact future demand distribution', () => {
  it('uses the finite 32-bit threshold masses rather than rounded decimal probabilities', () => {
    const denominator = 4_294_967_296n;
    expect(OFF_PEAK_BASE_COUNT_PROBABILITIES.map(serializeRational)).toEqual([
      { numerator: '1', denominator: '2' },
      { numerator: '1717986919', denominator: denominator.toString() },
      { numerator: '429496729', denominator: denominator.toString() },
    ]);
    expect(compare(OFF_PEAK_BASE_COUNT_PROBABILITIES.reduce(add, rational(0)), rational(1))).toBe(0);
  });
  it.each([{ rainActive: false, promotionActive: false }, { rainActive: true, promotionActive: false }, { rainActive: false, promotionActive: true }, { rainActive: true, promotionActive: true }])('normalizes every exact branch distribution: %o', options => {
    const branches = enumerateFutureArrivals(119, options);
    expect(compare(branches.reduce((sum, branch) => add(sum, branch.probability), rational(0)), rational(1))).toBe(0);
    for (const branch of branches) {
      expect(compare(branch.probability, rational(0))).toBe(1);
      for (const customer of branch.arrivals) expect(customer.deadlineTick - customer.arrivalTick).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('tiny exact finite-horizon solver', () => {
  it('hand-checks terminal WAIT with no arrivals or future decision', () => {
    const result = solveStaticTask(task(emptyPrepared(119)));
    expect(result.optimalActions).toEqual(['WAIT']);
    expect(result.actionValues).toEqual([{ action: 'WAIT', expectedFinalUtility: { numerator: '-3000', denominator: '1' }, expectedRemainingUtility: { numerator: '0', denominator: '1' } }]);
    expect(result.exploredBranches).toBe(0);
    expect(ExactOracleResultSchema.parse(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });
  it('hand-checks a last-tick SERVE versus WAIT, including closing abandonment and waste', () => {
    const state = emptyPrepared(119);
    state.readyBatches = [{ id: 'batch-119', quantity: 1, expiresAt: 139 }]; state.totals.wasted = 11;
    state.queue = [{ id: 'customer-119-base-0', arrivalTick: 119, patience: 3, deadlineTick: 122 }]; state.totals.arrivals = 1;
    const result = solveStaticTask(task(state));
    expect(result.optimalActions).toEqual(['SERVE']);
    expect(result.actionValues.map(a => [a.action, a.expectedFinalUtility])).toEqual([
      ['SERVE', { numerator: '-2450', denominator: '1' }],
      ['WAIT', { numerator: '-3105', denominator: '1' }],
    ]);
  });
  it('hand-checks one hidden future-demand tick using exact expected customer count', () => {
    const result = solveStaticTask(task(emptyPrepared(118)));
    // No ready food: every future customer abandons at closing after one minute.
    // E[n] = (1717986919 + 2*429496729)/2^32. Each costs 100+5 utility points.
    const expected = subtract(rational(-3000), multiply(rational(105), rational(2_576_980_377n, 4_294_967_296n)));
    expect(result.optimalActions).toEqual(['WAIT']);
    expect(result.actionValues[0]?.expectedFinalUtility).toEqual(serializeRational(expected));
    expect(result.exploredBranches).toBe(73);
  });
  it('chooses a different continuation after observing each future demand outcome', () => {
    const state = emptyPrepared(118);
    state.readyBatches = [{ id: 'batch-118', quantity: 1, expiresAt: 138 }]; state.totals.wasted = 11;
    const probabilities = OFF_PEAK_BASE_COUNT_PROBABILITIES;
    const expected = add(add(multiply(probabilities[0]!, rational(-3000)), multiply(probabilities[1]!, rational(-2450))), multiply(probabilities[2]!, rational(-2555)));
    const result = solveStaticTask(task(state));
    // WAIT is forced at 118. At 119 choose SERVE only in branches with customers.
    expect(result.optimalActions).toEqual(['WAIT']);
    expect(result.actionValues[0]?.expectedFinalUtility).toEqual(serializeRational(expected));
  });
  it('enumerates rain and promotion from active state without a future event schedule', () => {
    const rain = emptyPrepared(118);
    rain.effects = [{ type: 'rain', startsAt: 118, endsAt: 127 }];
    const expectedRain = subtract(rational(-3000), multiply(rational(105), rational(2_576_980_377n, 8_589_934_592n)));
    expect(solveStaticTask(task(rain)).actionValues[0]?.expectedFinalUtility).toEqual(serializeRational(expectedRain));
    const promo = emptyPrepared(118);
    promo.promotion = { startsAt: 110, endsAt: 119 }; promo.promotionEligibleAt = 129;
    promo.cashCents = 19500; promo.totals.promotions = 1;
    const expectedPromo = subtract(subtract(rational(-3500), multiply(rational(105), rational(2_576_980_377n, 4_294_967_296n))), rational(105, 2));
    expect(solveStaticTask(task(promo)).actionValues[0]?.expectedFinalUtility).toEqual(serializeRational(expectedPromo));
  });
  it('fails closed with dedicated counters when a branch or state cap is exceeded', () => {
    for (const limits of [{ maxBranches: 1 }, { maxStates: 1 }]) {
      try { solveStaticTask(task(emptyPrepared(118)), limits); throw new Error('should reject'); }
      catch (error) {
        expect(error).toBeInstanceOf(OracleLimitError);
        expect((error as OracleLimitError).code).toBe('ORACLE_LIMIT_EXCEEDED');
        expect((error as OracleLimitError).exploredStates).toBeGreaterThanOrEqual(1);
        expect((error as OracleLimitError).exploredBranches).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('rejects hidden seed input, non-prepared state, unsupported horizon and unmanifested future events', () => {
    const base = task(emptyPrepared(119));
    expect(OracleTaskSchema.safeParse({ ...base, seed: 0 }).success).toBe(false);
    expect(OracleTaskSchema.safeParse({ ...base, horizonEndTick: 119 }).success).toBe(false);
    expect(OracleTaskSchema.safeParse({ ...base, futureEvents: [{ type: 'rain', tick: 119 }] }).success).toBe(false);
    expect(() => solveStaticTask(task({ ...base.initialState, phase: 'committed' }))).toThrow();
    expect(() => solveStaticTask(task({ ...base.initialState, tick: 116 }))).toThrow();
  });
  it('does not mutate the prepared initial state', () => {
    const state = emptyPrepared(118), before = JSON.stringify(state);
    solveStaticTask(task(state));
    expect(JSON.stringify(state)).toBe(before);
  });
});
