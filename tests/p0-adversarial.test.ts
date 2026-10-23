import { describe, expect, it } from 'vitest';
import {
  ACTIONS, CONTRACT_VERSIONS, DEMAND_CONFIG, POC_CONFIG, RULES_CONFIG, TRIAL_CONFIG,
} from '../packages/shared/src/config.js';

describe('P0 configuration safety', () => {
  it('prevents accidental runtime mutation of nested baseline conditions', () => {
    const firstRule = RULES_CONFIG.orderedRules[0];
    expect(Object.isFrozen(RULES_CONFIG)).toBe(true);
    expect(Object.isFrozen(RULES_CONFIG.orderedRules)).toBe(true);
    expect(Object.isFrozen(firstRule.condition)).toBe(true);
    expect(() => Object.assign(firstRule.condition, { headDeadlineWithin: 99 })).toThrow(TypeError);
  });

  it('keeps development seeds separate from held-out trials and stages each shock equally', () => {
    const heldOut = new Set([...TRIAL_CONFIG.cleanSeeds, ...TRIAL_CONFIG.stressSeeds]);
    expect(TRIAL_CONFIG.developmentSeeds.filter((seed) => heldOut.has(seed))).toEqual([]);
    expect(TRIAL_CONFIG.staticDevelopmentSeeds.filter((seed) => TRIAL_CONFIG.staticHeldOutSeeds.includes(seed))).toEqual([]);
    expect(TRIAL_CONFIG.stressStages.flat()).toEqual(TRIAL_CONFIG.stressSeeds);
    const events = TRIAL_CONFIG.stressSeeds.map((seed) => TRIAL_CONFIG.stressEventBySeedModulo3[seed % 3]);
    for (const event of TRIAL_CONFIG.stressEventBySeedModulo3) {
      expect(events.filter((value) => value === event)).toHaveLength(2);
      for (const stage of TRIAL_CONFIG.stressStages) {
        expect(stage.filter((seed) => TRIAL_CONFIG.stressEventBySeedModulo3[seed % 3] === event)).toHaveLength(1);
      }
    }
  });

  it('keeps declared request ceilings consistent with worst-case episode dispatch', () => {
    const decisions = POC_CONFIG.lastDecisionTick - POC_CONFIG.firstDecisionTick + 1;
    expect(decisions).toBe(POC_CONFIG.maxRequestsPerProvider);
    expect(TRIAL_CONFIG.cleanSeeds.length * decisions).toBe(TRIAL_CONFIG.cleanRequestsPerProvider);
    expect(TRIAL_CONFIG.stressSeeds.length * decisions).toBe(TRIAL_CONFIG.stressRequestsPerProvider);
    expect(TRIAL_CONFIG.cleanRequestsPerProvider + TRIAL_CONFIG.stressRequestsPerProvider).toBe(TRIAL_CONFIG.totalRequestsPerProvider);
    expect(TRIAL_CONFIG.totalRequestsPerProvider * 3).toBe(TRIAL_CONFIG.totalRequestsThreeProviders);
  });

  it('keeps demand randomness separate from presentation and baseline policy selection', () => {
    expect(DEMAND_CONFIG.streams).not.toContain('sprite');
    expect(DEMAND_CONFIG.streams).not.toContain('decoration');
    expect(RULES_CONFIG.orderedRules.map((rule) => rule.priority)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(RULES_CONFIG.orderedRules.every((rule) => ACTIONS.includes(rule.action))).toBe(true);
    expect(CONTRACT_VERSIONS.failurePolicy).toBe('fallback-2');
  });
});

import {
  AttemptRecordSchema, DecisionInputSchema, DecisionResultSchema, ObservationSchema,
  ProviderEvidenceSchema, RecoverySnapshotSchema, RunManifestSchema, SimulatorStateSchema,
  TrialBudgetSchema,
} from '../packages/shared/src/schemas.js';

const runId = '9486d1b8-a580-469d-a357-cedda020ccde';
const zeroTotals = () => ({
  served: 0, abandoned: 0, wasted: 0, waitMinutes: 0, arrivals: 0,
  purchasedPortions: 0, restockOrders: 0, promotions: 0,
});
const initialState = () => ({
  tick: 0, phase: 'decision', cashCents: 20000, rawPortions: 30,
  readyBatches: [{ id: 'batch-0', quantity: 12, expiresAt: 20 }],
  cooking: null, pendingRestock: null, promotion: null, promotionEligibleAt: 0,
  queue: [], effects: [], totals: zeroTotals(),
});
const initialObservation = () => {
  const { phase: _phase, ...state } = initialState();
  return {
    ...state, schemaVersion: 'observation-2', remainingMinutes: 120,
    demandPhase: 'off-peak', cumulativeRevenueCents: 0, cumulativePurchasesCents: 0,
    cumulativePromotionSpendCents: 0, recentActions: [],
    legalActions: ['COOK', 'RESTOCK', 'PROMOTE', 'WAIT'],
  };
};
const validInput = () => ({
  roundId: runId, tick: 0, observation: initialObservation(),
  legalActions: ['COOK', 'RESTOCK', 'PROMOTE', 'WAIT'],
});
const validManifest = () => ({
  schemaVersion: 'manifest-1', manifestId: 'p0-adversarial', classification: 'offline-contract',
  sourceRevision: null, contracts: CONTRACT_VERSIONS, configurationHash: 'a'.repeat(64),
  seedCohorts: {
    development: [...TRIAL_CONFIG.developmentSeeds], clean: [...TRIAL_CONFIG.cleanSeeds],
    stress: [...TRIAL_CONFIG.stressSeeds], staticDevelopment: [...TRIAL_CONFIG.staticDevelopmentSeeds],
    staticHeldOut: [...TRIAL_CONFIG.staticHeldOutSeeds],
  },
  stressStages: TRIAL_CONFIG.stressStages.map((stage) => [...stage]), stressEventTick: 60,
  policies: ['jev', 'zoom', 'zoom-pro', 'rules'], liveDispatchEnabled: false,
  providerRequestLimit: 120, retries: 0, deadlineMs: 4000, status: 'planned',
});
const reservedAttempt = () => ({
  schemaVersion: 'fallback-2', runId, tick: 0, provider: 'jev', state: 'reserved',
  attemptCount: 0, fencingToken: 1, reservationId: 'reservation-1', quotaPool: 'trial-pool',
  reservedCostMicros: 100, reservedRequests: 1, dispatchAt: null, deadlineAt: null,
  receivedAt: null, monotonicDispatchMs: null, response: null, appliedAction: null,
  retryAllowed: false, possibleChargeRetained: false,
});
const validRecovery = () => ({
  schemaVersion: 'recovery-1', runId, sequence: 0, contracts: CONTRACT_VERSIONS,
  configurationHash: 'a'.repeat(64), scheduleHash: 'b'.repeat(64),
  simulatorStateHash: 'c'.repeat(64), state: initialState(), scheduleReference: 'schedule-1',
  privateIdMap: {}, attempts: [reservedAttempt()], reservationReferences: ['reservation-1'],
  operatorPaused: false, voteRemainingMs: null, fencingToken: 1,
});

describe('observation-2 rejects direct private-data disclosure', () => {
  it('accepts a complete initial request before applying negative mutations', () => {
    expect(DecisionInputSchema.safeParse(validInput()).success).toBe(true);
  });

  it.each(['seed', 'futureSchedule', 'oracleAction', 'otherPolicyState', 'apiKey'])('rejects unknown top-level %s', (key) => {
    expect(ObservationSchema.safeParse({ ...initialObservation(), [key]: 'private-value' }).success).toBe(false);
  });

  it('rejects a hidden seed attached to a nested action-history record', () => {
    const observation = {
      ...initialObservation(), tick: 1, remainingMinutes: 119,
      recentActions: [{ tick: 0, action: 'WAIT', seed: 1000 }],
    };
    expect(ObservationSchema.safeParse(observation).success).toBe(false);
  });

  it('rejects private customer IDs even if other customer data is valid', () => {
    const observation = {
      ...initialObservation(), totals: { ...zeroTotals(), arrivals: 1 },
      queue: [{ id: '1000-customer-0-base-0', arrivalTick: 0, patience: 3, deadlineTick: 3 }],
    };
    expect(ObservationSchema.safeParse(observation).success).toBe(false);
    observation.queue[0]!.id = 'customer-0-base-0';
    expect(ObservationSchema.safeParse(observation).success).toBe(true);
  });

  it('rejects seed-bearing round IDs and extra SDK metadata', () => {
    expect(DecisionInputSchema.safeParse({ ...validInput(), roundId: 'round-seed-1000' }).success).toBe(false);
    expect(DecisionInputSchema.safeParse({ ...validInput(), sdkMetadata: { seed: 1000 } }).success).toBe(false);
  });

  it.each([
    ['WAIT', 'COOK'], ['COOK', 'COOK', 'WAIT'], ['COOK'], [], ['WAIT', 'WAIT'],
  ])('rejects noncanonical or incomplete legal actions %j', (...actions) => {
    expect(ObservationSchema.safeParse({ ...initialObservation(), legalActions: actions }).success).toBe(false);
  });

  it('rejects mismatched input and observation ticks or action sets', () => {
    expect(DecisionInputSchema.safeParse({ ...validInput(), tick: 1 }).success).toBe(false);
    expect(DecisionInputSchema.safeParse({ ...validInput(), legalActions: ['WAIT'] }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...initialObservation(), remainingMinutes: 119 }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...initialObservation(), demandPhase: 'peak' }).success).toBe(false);
  });

  it('rejects current/future action history and decisions at closing', () => {
    expect(ObservationSchema.safeParse({ ...initialObservation(), recentActions: [{ tick: 0, action: 'WAIT' }] }).success).toBe(false);
    expect(ObservationSchema.safeParse({ ...initialObservation(), tick: 120, remainingMinutes: 0 }).success).toBe(false);
  });
});

describe('simulator-state contract invariants', () => {
  it('accepts initial stock and rejects missing inventory or unearned cash', () => {
    expect(SimulatorStateSchema.safeParse(initialState()).success).toBe(true);
    expect(SimulatorStateSchema.safeParse({ ...initialState(), rawPortions: 29 }).success).toBe(false);
    expect(SimulatorStateSchema.safeParse({ ...initialState(), cashCents: 20500 }).success).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, -0, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects noncanonical cash %s', (cashCents) => {
    expect(SimulatorStateSchema.safeParse({ ...initialState(), cashCents }).success).toBe(false);
  });

  it('rejects capacity overflow even when portions are conserved', () => {
    const state = { ...initialState(), rawPortions: 11, readyBatches: [{ id: 'batch-0', quantity: 21, expiresAt: 20 }], cooking: { quantity: 10, dueTick: 5 } };
    expect(SimulatorStateSchema.safeParse(state).success).toBe(false);
  });

  it('rejects customers at their patience deadline in a decision observation', () => {
    const observation = {
      ...initialObservation(), tick: 3, remainingMinutes: 117,
      totals: { ...zeroTotals(), arrivals: 1 },
      queue: [{ id: 'customer-0-base-0', arrivalTick: 0, patience: 3, deadlineTick: 3 }],
    };
    expect(ObservationSchema.safeParse(observation).success).toBe(false);
  });

  it('rejects unsettled terminal stock and inconsistent closed tick', () => {
    expect(SimulatorStateSchema.safeParse({ ...initialState(), tick: 120, phase: 'closed' }).success).toBe(false);
    expect(SimulatorStateSchema.safeParse({ ...initialState(), phase: 'closed' }).success).toBe(false);
    const state = { ...initialState(), tick: 120, phase: 'closed', readyBatches: [], totals: { ...zeroTotals(), wasted: 12 } };
    expect(SimulatorStateSchema.safeParse(state).success).toBe(true);
  });
});

describe('provider attribution and trial gates', () => {
  it('rejects fabricated success or unattributed baseline substitution', () => {
    const result = { provider: 'jev', action: 'COOK', latencyMs: 100, status: 'success' };
    expect(DecisionResultSchema.safeParse(result).success).toBe(true);
    expect(DecisionResultSchema.safeParse({ ...result, action: null }).success).toBe(false);
    expect(DecisionResultSchema.safeParse({ ...result, fallbackReason: 'timeout' }).success).toBe(false);
    expect(DecisionResultSchema.safeParse({ ...result, appliedAction: 'WAIT' }).success).toBe(false);
    expect(DecisionResultSchema.safeParse({ ...result, status: 'fallback' }).success).toBe(false);
    expect(DecisionResultSchema.safeParse({ ...result, status: 'fallback', appliedAction: 'WAIT', fallbackReason: 'timeout', fallbackPolicy: 'rules-1' }).success).toBe(true);
  });

  it('requires documented confidence/probability semantics and unique probability actions', () => {
    const result = { provider: 'jev', action: 'COOK', latencyMs: 100, status: 'success' };
    expect(DecisionResultSchema.safeParse({ ...result, confidence: .9 }).success).toBe(false);
    expect(DecisionResultSchema.safeParse({ ...result, probabilities: [{ action: 'COOK', probability: 1 }] }).success).toBe(false);
    expect(DecisionResultSchema.safeParse({ ...result, probabilitySemantics: 'documented-choice-distribution', probabilities: [{ action: 'COOK', probability: .5 }, { action: 'COOK', probability: .5 }] }).success).toBe(false);
  });

  it('rejects enabling an unverified adapter or claiming verified status without evidence', () => {
    const evidence = { provider: 'jev', status: 'not-verified', liveDispatchEnabled: false, evidence: null };
    expect(ProviderEvidenceSchema.safeParse(evidence).success).toBe(true);
    expect(ProviderEvidenceSchema.safeParse({ ...evidence, liveDispatchEnabled: true }).success).toBe(false);
    expect(ProviderEvidenceSchema.safeParse({ ...evidence, status: 'verified' }).success).toBe(false);
  });

  it('rejects expanded/reordered trial cohorts and live dispatch in the P0 manifest', () => {
    const manifest = validManifest();
    expect(RunManifestSchema.safeParse(manifest).success).toBe(true);
    expect(RunManifestSchema.safeParse({ ...manifest, liveDispatchEnabled: true }).success).toBe(false);
    expect(RunManifestSchema.safeParse({ ...manifest, seedCohorts: { ...manifest.seedCohorts, stress: [...manifest.seedCohorts.stress, 1006] } }).success).toBe(false);
    expect(RunManifestSchema.safeParse({ ...manifest, stressStages: [...manifest.stressStages].reverse() }).success).toBe(false);
    expect(RunManifestSchema.safeParse({ ...manifest, policies: ['jev', 'zoom'] }).success).toBe(false);
    expect(RunManifestSchema.safeParse({ ...manifest, retries: 1 }).success).toBe(false);
  });

  it('rejects expired trials, overages and request bounds that cannot fit the cap', () => {
    const budget = {
      currency: 'USD', perRequestCostBoundMicros: 10, episodeCurrencyCapMicros: 1200,
      campaignCurrencyCapMicros: 5000, requestLimit: 200, tokenLimit: 20000,
      remainingRequests: 100, remainingTokens: 10000, maxInputTokens: 200, maxOutputTokens: 100,
      quotaPool: 'shared-trial', expiresAt: '2026-11-01T00:00:00Z', checkedAt: '2026-10-22T00:00:00Z',
      automaticUpgradeAllowed: false, paidOveragesAllowed: false,
    };
    expect(TrialBudgetSchema.safeParse(budget).success).toBe(true);
    expect(TrialBudgetSchema.safeParse({ ...budget, expiresAt: budget.checkedAt }).success).toBe(false);
    expect(TrialBudgetSchema.safeParse({ ...budget, paidOveragesAllowed: true }).success).toBe(false);
    expect(TrialBudgetSchema.safeParse({ ...budget, perRequestCostBoundMicros: 1201 }).success).toBe(false);
    expect(TrialBudgetSchema.safeParse({ ...budget, remainingRequests: 0 }).success).toBe(false);
    expect(TrialBudgetSchema.safeParse({ ...budget, remainingTokens: 299 }).success).toBe(false);
  });
});

describe('attempt/recovery contract boundaries', () => {
  it('rejects retries, reset deadlines and late durable responses', () => {
    expect(AttemptRecordSchema.safeParse(reservedAttempt()).success).toBe(true);
    const intent = { ...reservedAttempt(), state: 'dispatch_intent', attemptCount: 1, dispatchAt: 1000, deadlineAt: 5000, monotonicDispatchMs: 20 };
    expect(AttemptRecordSchema.safeParse(intent).success).toBe(true);
    expect(AttemptRecordSchema.safeParse({ ...intent, attemptCount: 2 }).success).toBe(false);
    expect(AttemptRecordSchema.safeParse({ ...intent, retryAllowed: true }).success).toBe(false);
    expect(AttemptRecordSchema.safeParse({ ...intent, deadlineAt: 6000 }).success).toBe(false);
    expect(AttemptRecordSchema.safeParse({ ...intent, receivedAt: 5001 }).success).toBe(false);
    expect(AttemptRecordSchema.safeParse({ ...intent, state: 'uncertain', possibleChargeRetained: false }).success).toBe(false);
    expect(AttemptRecordSchema.safeParse({ ...intent, state: 'uncertain', possibleChargeRetained: true }).success).toBe(true);
  });

  it('rejects recovery with duplicate attempts or attempts belonging to a different run', () => {
    const recovery = validRecovery();
    expect(RecoverySnapshotSchema.safeParse(recovery).success).toBe(true);
    expect(RecoverySnapshotSchema.safeParse({ ...recovery, attempts: [...recovery.attempts, reservedAttempt()] }).success).toBe(false);
    expect(RecoverySnapshotSchema.safeParse({ ...recovery, attempts: [{ ...reservedAttempt(), runId: 'f020de31-9ae6-48b7-b536-d5e9f6f6a216' }] }).success).toBe(false);
  });
});

import { TrialEvaluationPlanSchema } from '../packages/shared/src/index.js';
import { readProjectJson } from '../scripts/config-snapshot.js';
import { FixtureSetSchema } from '../scripts/p0-artifacts.js';

function mutatePath(value: unknown, path: string, replacement: unknown): unknown {
  const copy = structuredClone(value) as Record<string, unknown>;
  const parts = path.split('.');
  let parent = copy;
  for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
  parent[parts[parts.length - 1]!] = replacement;
  return copy;
}

describe('rich trial artifact rejects frozen safety-policy drift', () => {
  const plan = readProjectJson('manifests/trial-eval-1.json');
  it('accepts the actual complete planned artifact', () => {
    expect(TrialEvaluationPlanSchema.safeParse(plan).success).toBe(true);
  });

  it.each([
    ['requestPolicy.deadlineMs', 40000],
    ['requestPolicy.automaticRetriesPerTick', 5],
    ['requestPolicy.uncertainAttemptRedispatchAllowed', true],
    ['requestPolicy.reserveCostAndQuotaBeforeDispatch', false],
    ['budget.paidOveragesAllowed', true],
    ['budget.automaticUpgradeAllowed', true],
    ['budget.missingBudgetOrQuotaAllowsDispatch', true],
    ['budget.smokeAndStaticBudgetRequiredSeparately', false],
    ['cohorts.clean.audienceVoting', true],
    ['cohorts.stress.shockTick', 61],
    ['cohorts.stress.maximumPairedSeeds', 30],
    ['cohorts.stress.continuationMayDependOnScores', true],
    ['cohorts.stress.stages.1.requiresRemainingReservedQuota', false],
    ['requestCeilings.stressPerLiveProvider', 3600],
    ['requestCeilings.rulesPaidRequests', 120],
    ['seedSplits.sequentialDevelopment', [1000]],
    ['seedSplits.staticHeldOutGenerator', [2000]],
    ['seedSplits.futureResearchSeeds.enabled', true],
    ['reporting.keepCohortsSeparate', false],
    ['reporting.retainFailuresAndFallbacks', false],
    ['reporting.stressUncertainty', 'robust-provider-ranking'],
    ['providerPolicy.zoom-pro.liveEnabled', true],
    ['providerPolicy.jev.modelId', 'unverified-replacement'],
    ['referenceChecksum', 'a'.repeat(64)],
    ['referenceChecksumStatus', 'verified'],
  ])('rejects mutation of %s', (path, replacement) => {
    expect(TrialEvaluationPlanSchema.safeParse(mutatePath(plan, path, replacement)).success).toBe(false);
  });
});

describe('fixture artifacts retain shared structural safety checks', () => {
  const fixtures = readProjectJson('fixtures/poc-1-acceptance.json');
  it('rejects duplicate batch IDs and unsafe synthetic numbers', () => {
    const duplicateBatches = [
      { id: 'batch-0', quantity: 6, expiresAt: 20 },
      { id: 'batch-0', quantity: 6, expiresAt: 20 },
    ];
    expect(FixtureSetSchema.safeParse(mutatePath(fixtures, 'cases.0.given.readyBatches', duplicateBatches)).success).toBe(false);
    expect(FixtureSetSchema.safeParse(mutatePath(fixtures, 'cases.0.given.cashCents', -0)).success).toBe(false);
    expect(FixtureSetSchema.safeParse(mutatePath(fixtures, 'cases.0.given.cashCents', Number.MAX_SAFE_INTEGER + 1)).success).toBe(false);
  });
});
