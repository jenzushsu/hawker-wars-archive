/** Frozen P0 contract defaults. Configuration only: no transition engine or dispatch. */
type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    Object.values(value).forEach((child: unknown) => deepFreeze(child));
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export const ACTIONS = Object.freeze(['SERVE', 'COOK', 'RESTOCK', 'PROMOTE', 'WAIT'] as const);
export const PROVIDERS = Object.freeze(['jev', 'zoom', 'zoom-pro', 'rules'] as const);
export const CHAOS_EVENTS = Object.freeze(['bus', 'rain', 'supplier-delay'] as const);
export const CONTRACT_VERSIONS = deepFreeze({
  simulation: 'poc-1', demand: 'demand-1', scorer: 'utility-1', baseline: 'rules-1',
  failurePolicy: 'fallback-2', observation: 'observation-2', stateHash: 'state-hash-1',
  recovery: 'recovery-1', staticTask: 'static-task-1', evaluation: 'trial-eval-1',
} as const);
export const POC_CONFIG = deepFreeze({
  closingTick: 120, firstDecisionTick: 0, lastDecisionTick: 119,
  initialCashCents: 20_000, initialReady: 12, initialRaw: 30, initialReadyExpiryTick: 20,
  salePriceCents: 500, ingredientValueCents: 200, initialWealthCents: 28_400,
  queueCapacity: 30, serveLimit: 3, cookBatchSize: 10, cookingMinutes: 5,
  readyCapacity: 30, readyShelfLifeMinutes: 20, rawCapacity: 60,
  restockQuantity: 20, restockCostCents: 4_000, restockMinutes: 10, maxPendingRestocks: 1,
  promotionCostCents: 500, promotionDelayMinutes: 1, promotionDurationMinutes: 10,
  promotionCooldownMinutes: 20, promotionMaxQueue: 5, promotionMinReady: 10,
  visualTickMs: 5_000, decisionDeadlineMs: 4_000, retriesPerTick: 0, maxRequestsPerProvider: 120,
  rawSpoilage: false, terminalReadyValueCents: 0, forcedWaitCallsProvider: false,
  tickOrder: ['external_events', 'expiry_and_completions', 'arrivals', 'patience_expiry',
    'observations', 'dispatch', 'validated_actions', 'atomic_commit'] as const,
});
export const DEMAND_CONFIG = deepFreeze({
  hashAlgorithm: 'sha256', drawPrefix: 'hawker-wars|demand-1', drawBytes: 4,
  drawByteOrder: 'big-endian', drawDenominator: 4_294_967_296,
  streams: ['base_count', 'patience', 'promo_count', 'rain_keep', 'vote_tie'] as const,
  phases: [
    { id: 'off-peak', ranges: [[0, 29], [90, 119]], counts: [0, 1, 2], cumulativeThresholds: [0.5, 0.9, 1] },
    { id: 'peak', ranges: [[30, 89]], counts: [1, 2], cumulativeThresholds: [0.5, 1] },
  ],
  patienceMinimum: 3, patienceModulo: 8, promotionExtraThreshold: 0.5,
  potentialArrivalOrder: ['base', 'bus', 'promotion'] as const,
  busArrivals: 6, rainDurationMinutes: 10, rainKeepThreshold: 0.5,
  supplierDelayMinutes: 5, supplierDelayDurationMinutes: 10, supplierLatestDueTick: 119,
  maxChaosEvents: 1, voteOpensAfterTick: 30, voteWindowMs: 20_000,
  voteChangesAllowed: true, noVotesEffect: null,
});
export const SCORE_CONFIG = deepFreeze({
  profitWeight: 1, abandonmentPenalty: 100, waitMinutePenalty: 5, wastePortionPenalty: 50,
  satisfactionMaximum: 100, satisfactionWaitPenalty: 10, abandonedSatisfaction: 0,
  primaryControllerObjective: 'utility', equalScoresShareRank: true,
  waitPopulation: 'all-resolved-customers', apiCostInUtility: false,
});
export const RULES_CONFIG = deepFreeze({
  version: 'rules-1', matching: 'first-legal-match', pipelineIncludesReady: false,
  orderedRules: [
    { priority: 1, action: 'SERVE', condition: { queueAbove: 0, readyAbove: 0, headDeadlineWithin: 1 } },
    { priority: 2, action: 'COOK', condition: { readyAtMost: 5, remainingAtLeast: 6 } },
    { priority: 3, action: 'RESTOCK', condition: { pipelineAtMost: 10, remainingAtLeast: 25 } },
    { priority: 4, action: 'SERVE', condition: { queueAbove: 0, readyAbove: 0 } },
    { priority: 5, action: 'COOK', condition: { readyAtMost: 15, remainingAtLeast: 15 } },
    { priority: 6, action: 'RESTOCK', condition: { pipelineAtMost: 20, remainingAtLeast: 35 } },
    { priority: 7, action: 'PROMOTE', condition: { queueAtMost: 2, readyAtLeast: 15, remainingAtLeast: 25 } },
    { priority: 8, action: 'WAIT', condition: {} },
  ],
} as const);
const range = (start: number, count: number): number[] => Array.from({ length: count }, (_, i) => start + i);
export const TRIAL_CONFIG = deepFreeze({
  version: 'trial-eval-1', developmentSeeds: range(0, 100), cleanSeeds: range(1000, 30),
  stressSeeds: range(1000, 6), stressStages: [range(1000, 3), range(1003, 3)],
  stressEventTick: 60, stressEventBySeedModulo3: ['bus', 'rain', 'supplier-delay'] as const,
  stressReporting: 'exploratory-descriptive', staticDevelopmentSeeds: range(2000, 100),
  staticHeldOutSeeds: range(3000, 100), cleanRequestsPerProvider: 3_600,
  stressRequestsPerProvider: 720, totalRequestsPerProvider: 4_320, totalRequestsThreeProviders: 12_960,
  quotasRequiredBeforeDispatch: true, paidOveragesAllowed: false, automaticUpgradeAllowed: false,
  stressExpansionDeferred: true, researchExpansionDeferred: true,
});
export const STATIC_TASK_CONFIG = deepFreeze({
  version: 'static-task-1', initialTicks: [117, 118, 119], closingTick: 120,
  terminalValuation: 'utility-1-closing-settlement', exactArithmetic: 'rational',
  includeAllOptimalActions: true, approximateLabels: 'agreement-only',
  generatorBranchLimitMustBePreregistered: true,
});
