import { z } from 'zod';
import { ACTIONS, PROVIDERS, CHAOS_EVENTS, CONTRACT_VERSIONS, POC_CONFIG, TRIAL_CONFIG } from './config.js';

export const SafeIntegerSchema = z.number().int().safe().refine((n) => !Object.is(n, -0), 'negative zero is not canonical');
export const NonnegativeIntegerSchema = SafeIntegerSchema.refine((n) => n >= 0, 'must be nonnegative');
const boundedInteger = (min: number, max: number) => SafeIntegerSchema.refine((n) => n >= min && n <= max, `must be between ${min} and ${max}`);
export const IdentifierSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ActionSchema = z.enum(ACTIONS);
export const ProviderIdSchema = z.enum(PROVIDERS);
export const ChaosEventSchema = z.enum(CHAOS_EVENTS);
export const ContractVersionsSchema = z.object({
  simulation: z.literal(CONTRACT_VERSIONS.simulation), demand: z.literal(CONTRACT_VERSIONS.demand),
  scorer: z.literal(CONTRACT_VERSIONS.scorer), baseline: z.literal(CONTRACT_VERSIONS.baseline),
  failurePolicy: z.literal(CONTRACT_VERSIONS.failurePolicy), observation: z.literal(CONTRACT_VERSIONS.observation),
  stateHash: z.literal(CONTRACT_VERSIONS.stateHash), recovery: z.literal(CONTRACT_VERSIONS.recovery),
  staticTask: z.literal(CONTRACT_VERSIONS.staticTask), evaluation: z.literal(CONTRACT_VERSIONS.evaluation),
}).strict();
export const LegalActionsSchema = z.array(ActionSchema).min(1).max(5).superRefine((actions, ctx) => {
  if (actions[actions.length - 1] !== 'WAIT') ctx.addIssue({ code: 'custom', message: 'WAIT must always be present and last' });
  if (actions.some((action, i) => i > 0 && ACTIONS.indexOf(action) <= ACTIONS.indexOf(actions[i - 1]!))) {
    ctx.addIssue({ code: 'custom', message: 'legal actions must be unique and in canonical action order' });
  }
});
export const ReadyBatchSchema = z.object({ id: IdentifierSchema, quantity: boundedInteger(1, 30), expiresAt: boundedInteger(1, 139) }).strict();
export const CookingSchema = z.object({ quantity: z.literal(10), dueTick: boundedInteger(1, 119) }).strict();
export const PendingRestockSchema = z.object({ quantity: z.literal(20), dueTick: boundedInteger(1, 119), delayApplied: z.boolean() }).strict();
export const PromotionSchema = z.object({ startsAt: boundedInteger(1, 110), endsAt: boundedInteger(10, 119) }).strict()
  .refine((p) => p.endsAt === p.startsAt + 9, 'promotion spans exactly ten inclusive ticks');
export const CustomerSchema = z.object({
  id: IdentifierSchema, arrivalTick: boundedInteger(0, 119), patience: boundedInteger(3, 10), deadlineTick: boundedInteger(3, 129),
}).strict().refine((c) => c.deadlineTick === c.arrivalTick + c.patience, 'customer deadline must equal arrival plus patience');
export const EffectSchema = z.object({ type: ChaosEventSchema, startsAt: boundedInteger(0, 119), endsAt: boundedInteger(0, 128) }).strict()
  .refine((e) => e.endsAt === e.startsAt + (e.type === 'bus' ? 0 : 9), 'effect duration must match demand-1');
export const TotalsSchema = z.object({
  served: NonnegativeIntegerSchema, abandoned: NonnegativeIntegerSchema, wasted: NonnegativeIntegerSchema,
  waitMinutes: NonnegativeIntegerSchema, arrivals: NonnegativeIntegerSchema, purchasedPortions: NonnegativeIntegerSchema,
  restockOrders: NonnegativeIntegerSchema, promotions: NonnegativeIntegerSchema,
}).strict();
const StateShape = {
  tick: boundedInteger(0, 120), phase: z.enum(['decision', 'committed', 'closed']),
  cashCents: NonnegativeIntegerSchema, rawPortions: boundedInteger(0, 60),
  readyBatches: z.array(ReadyBatchSchema).max(30), cooking: CookingSchema.nullable(),
  pendingRestock: PendingRestockSchema.nullable(), promotion: PromotionSchema.nullable(),
  promotionEligibleAt: boundedInteger(0, 129), queue: z.array(CustomerSchema).max(30),
  effects: z.array(EffectSchema).max(1), totals: TotalsSchema,
};
const StateObjectSchema = z.object(StateShape).strict();
type StateShapeType = z.infer<typeof StateObjectSchema>;
function compareCustomers(a: { id: string; arrivalTick: number }, b: { id: string; arrivalTick: number }): number {
  if (a.arrivalTick !== b.arrivalTick) return a.arrivalTick - b.arrivalTick;
  const pa = /^customer-\d+-(base|bus|promotion)-(\d+)$/.exec(a.id);
  const pb = /^customer-\d+-(base|bus|promotion)-(\d+)$/.exec(b.id);
  if (pa && pb) {
    const sources = ['base', 'bus', 'promotion'];
    return sources.indexOf(pa[1]!) - sources.indexOf(pb[1]!) || Number(pa[2]) - Number(pb[2]);
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function validateState(state: StateShapeType, ctx: z.RefinementCtx, globalLedger = true): void {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
  const ready = state.readyBatches.reduce((n, b) => n + b.quantity, 0);
  const cooking = state.cooking?.quantity ?? 0;
  const pending = state.pendingRestock?.quantity ?? 0;
  if (ready + cooking > 30) issue('ready stock plus cooking reservation exceeds capacity', ['readyBatches']);
  if (state.rawPortions + pending > 60) issue('raw stock plus pending reservation exceeds capacity', ['rawPortions']);
  if (globalLedger && 42 + state.totals.purchasedPortions !== state.rawPortions + ready + cooking + pending + state.totals.served + state.totals.wasted) issue('portion conservation failed', ['totals']);
  if (state.totals.purchasedPortions !== 20 * state.totals.restockOrders) issue('purchases must be full twenty-portion orders', ['totals']);
  if (globalLedger && state.cashCents !== 20_000 + 500 * state.totals.served - 4_000 * state.totals.restockOrders - 500 * state.totals.promotions) issue('cash conservation failed', ['cashCents']);
  if (state.totals.arrivals !== state.totals.served + state.totals.abandoned + state.queue.length) issue('customer conservation failed', ['totals']);
  if (new Set(state.readyBatches.map((b) => b.id)).size !== state.readyBatches.length) issue('batch IDs must be unique', ['readyBatches']);
  if (state.readyBatches.some((b, i) => i > 0 && (b.expiresAt < state.readyBatches[i - 1]!.expiresAt || (b.expiresAt === state.readyBatches[i - 1]!.expiresAt && b.id <= state.readyBatches[i - 1]!.id)))) issue('batches must be ordered by expiry then ID', ['readyBatches']);
  if (new Set(state.queue.map((c) => c.id)).size !== state.queue.length) issue('customer IDs must be unique', ['queue']);
  if (state.queue.some((c, i) => c.arrivalTick > state.tick || (i > 0 && compareCustomers(c, state.queue[i - 1]!) <= 0))) issue('queue must be FIFO and cannot include future arrivals', ['queue']);
  if (state.phase === 'closed' || (globalLedger && state.tick === 120)) {
    if (state.phase !== 'closed' || state.tick !== 120) issue('closed phase occurs exactly at tick 120');
    if (ready || cooking || pending || state.queue.length) issue('terminal settlement must resolve ready stock, in-flight stock and customers');
  }
  if (state.phase === 'decision') {
    if (state.readyBatches.some((b) => b.expiresAt <= state.tick)) issue('expired ready stock absent at decision boundary');
    if (state.queue.some((c) => c.deadlineTick <= state.tick)) issue('expired customers absent at decision boundary');
    if (state.cooking && state.cooking.dueTick <= state.tick) issue('due cooking must complete before observation');
    if (state.pendingRestock && state.pendingRestock.dueTick <= state.tick) issue('due restock must complete before observation');
    if (state.effects.some((e) => e.startsAt > state.tick || e.endsAt < state.tick)) issue('observed effects must currently be active');
  }
}
export const SimulatorStateSchema = StateObjectSchema.superRefine(validateState);
export type SimulatorState = z.infer<typeof SimulatorStateSchema>;
/** Synthetic fixture openings inject a local stock/cash ledger; never accept these as real episodes. */
export const FixtureStateSchema = StateObjectSchema.omit({ phase: true }).extend({
  phase: z.enum(['decision', 'committed', 'closed']).default('committed'),
}).strict().superRefine((state, ctx) => validateState(state, ctx, false));

const PublicCustomerSchema = z.object({
  id: z.string().regex(/^customer-(?:0|[1-9]\d{0,2})-(?:base|bus|promotion)-(?:0|[1-9]\d?)$/),
  arrivalTick: boundedInteger(0, 119), patience: boundedInteger(3, 10), deadlineTick: boundedInteger(3, 129),
}).strict().superRefine((c, ctx) => {
  if (c.deadlineTick !== c.arrivalTick + c.patience || Number(c.id.split('-')[1]) !== c.arrivalTick) {
    ctx.addIssue({ code: 'custom', message: 'public customer ID/deadline must match arrival tick' });
  }
});
const PublicReadyBatchSchema = z.object({
  id: z.string().regex(/^batch-(?:0|[1-9]\d*)$/), quantity: boundedInteger(1, 30), expiresAt: boundedInteger(1, 139),
}).strict();
export const ActionSummarySchema = z.object({ tick: boundedInteger(0, 119), action: ActionSchema }).strict();
export const ObservationSchema = z.object({
  schemaVersion: z.literal('observation-2'), tick: boundedInteger(0, 119), remainingMinutes: boundedInteger(1, 120),
  cashCents: NonnegativeIntegerSchema, rawPortions: boundedInteger(0, 60), readyBatches: z.array(PublicReadyBatchSchema).max(30),
  cooking: CookingSchema.nullable(), pendingRestock: PendingRestockSchema.nullable(), promotion: PromotionSchema.nullable(),
  promotionEligibleAt: boundedInteger(0, 129), queue: z.array(PublicCustomerSchema).max(30), effects: z.array(EffectSchema).max(1),
  demandPhase: z.enum(['off-peak', 'peak']),
  cumulativeRevenueCents: NonnegativeIntegerSchema, cumulativePurchasesCents: NonnegativeIntegerSchema,
  cumulativePromotionSpendCents: NonnegativeIntegerSchema, totals: TotalsSchema,
  recentActions: z.array(ActionSummarySchema).max(5), legalActions: LegalActionsSchema,
}).strict().superRefine((o, ctx) => {
  validateState({ ...o, phase: 'decision' }, ctx);
  if (o.remainingMinutes !== 120 - o.tick) ctx.addIssue({ code: 'custom', message: 'remaining minutes must match tick' });
  if (o.demandPhase !== (o.tick >= 30 && o.tick <= 89 ? 'peak' : 'off-peak')) ctx.addIssue({ code: 'custom', message: 'demand phase must match tick' });
  if (o.cumulativeRevenueCents !== o.totals.served * 500 || o.cumulativePurchasesCents !== o.totals.restockOrders * 4000 || o.cumulativePromotionSpendCents !== o.totals.promotions * 500) ctx.addIssue({ code: 'custom', message: 'cumulative accounting fields must match counters' });
  if (o.recentActions.some((a, i) => a.tick >= o.tick || (i > 0 && a.tick <= o.recentActions[i - 1]!.tick))) ctx.addIssue({ code: 'custom', message: 'recent actions must be ordered committed past ticks' });
});
export type Observation = z.infer<typeof ObservationSchema>;
export const DecisionInputSchema = z.object({
  roundId: z.string().uuid(), tick: boundedInteger(0, 119), observation: ObservationSchema, legalActions: LegalActionsSchema,
}).strict().superRefine((input, ctx) => {
  if (input.tick !== input.observation.tick) ctx.addIssue({ code: 'custom', message: 'input and observation ticks must match' });
  if (JSON.stringify(input.legalActions) !== JSON.stringify(input.observation.legalActions)) ctx.addIssue({ code: 'custom', message: 'input and observation legal actions must match' });
});
export type DecisionInput = z.infer<typeof DecisionInputSchema>;
export const UsageSchema = z.object({ inputTokens: NonnegativeIntegerSchema.optional(), outputTokens: NonnegativeIntegerSchema.optional(), costMicros: NonnegativeIntegerSchema.optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict();
export const DecisionResultSchema = z.object({
  provider: ProviderIdSchema, action: ActionSchema.nullable(), latencyMs: NonnegativeIntegerSchema,
  status: z.enum(['success', 'fallback', 'error']), modelVersion: IdentifierSchema.optional(), requestId: IdentifierSchema.optional(),
  probabilities: z.array(z.object({ action: ActionSchema, probability: z.number().finite().min(0).max(1) }).strict()).min(1).max(5).optional(),
  confidence: z.number().finite().optional(), confidenceSemantics: z.string().min(1).max(500).optional(),
  probabilitySemantics: z.string().min(1).max(500).optional(), usage: UsageSchema.optional(),
  appliedAction: ActionSchema.optional(), fallbackReason: z.enum(['invalid', 'illegal', 'network', 'rate-limit', 'timeout', 'uncertain', 'budget', 'quota']).optional(),
  fallbackPolicy: z.literal('rules-1').optional(),
}).strict().superRefine((r, ctx) => {
  if (r.status === 'success' && (r.action === null || r.fallbackReason || r.fallbackPolicy || (r.appliedAction !== undefined && r.appliedAction !== r.action))) ctx.addIssue({ code: 'custom', message: 'success requires a provider action and no fallback attribution' });
  if (r.status === 'fallback' && (!r.appliedAction || !r.fallbackReason || !r.fallbackPolicy)) ctx.addIssue({ code: 'custom', message: 'fallback must identify applied baseline action and reason' });
  if (r.confidence !== undefined && !r.confidenceSemantics) ctx.addIssue({ code: 'custom', message: 'confidence requires documented semantics' });
  if (r.probabilities && (!r.probabilitySemantics || new Set(r.probabilities.map((p) => p.action)).size !== r.probabilities.length)) ctx.addIssue({ code: 'custom', message: 'probabilities require semantics and unique actions' });
});
export type DecisionResult = z.infer<typeof DecisionResultSchema>;
export interface DecisionProvider { decide(input: DecisionInput): Promise<DecisionResult> }

const ExactSeeds = (expected: readonly number[]) => z.array(NonnegativeIntegerSchema).refine((values) => JSON.stringify(values) === JSON.stringify(expected), 'seed cohort must match frozen trial-eval-1');
export const RunManifestSchema = z.object({
  schemaVersion: z.literal('manifest-1'), manifestId: IdentifierSchema,
  classification: z.enum(['offline-contract', 'clean', 'stress', 'exhibition', 'replay']),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/).nullable(), contracts: ContractVersionsSchema, configurationHash: HashSchema,
  seedCohorts: z.object({ development: ExactSeeds(TRIAL_CONFIG.developmentSeeds), clean: ExactSeeds(TRIAL_CONFIG.cleanSeeds),
    stress: ExactSeeds(TRIAL_CONFIG.stressSeeds), staticDevelopment: ExactSeeds(TRIAL_CONFIG.staticDevelopmentSeeds),
    staticHeldOut: ExactSeeds(TRIAL_CONFIG.staticHeldOutSeeds) }).strict(),
  stressStages: z.tuple([ExactSeeds(TRIAL_CONFIG.stressStages[0]!), ExactSeeds(TRIAL_CONFIG.stressStages[1]!)]),
  stressEventTick: z.literal(60), policies: z.array(ProviderIdSchema).min(1).max(4), liveDispatchEnabled: z.literal(false),
  providerRequestLimit: z.literal(120), retries: z.literal(0), deadlineMs: z.literal(4000),
  status: z.enum(['planned', 'running', 'completed', 'cancelled']),
}).strict().superRefine((m, ctx) => {
  if (new Set(m.policies).size !== m.policies.length || !m.policies.includes('rules')) ctx.addIssue({ code: 'custom', message: 'policies must be unique and include rules baseline' });
});
export type RunManifest = z.infer<typeof RunManifestSchema>;

export const TrialBudgetSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/), perRequestCostBoundMicros: NonnegativeIntegerSchema,
  episodeCurrencyCapMicros: NonnegativeIntegerSchema, campaignCurrencyCapMicros: NonnegativeIntegerSchema,
  requestLimit: NonnegativeIntegerSchema, tokenLimit: NonnegativeIntegerSchema, remainingRequests: NonnegativeIntegerSchema,
  remainingTokens: NonnegativeIntegerSchema, maxInputTokens: NonnegativeIntegerSchema, maxOutputTokens: NonnegativeIntegerSchema,
  quotaPool: IdentifierSchema, expiresAt: z.string().datetime(), checkedAt: z.string().datetime(),
  automaticUpgradeAllowed: z.literal(false), paidOveragesAllowed: z.literal(false),
}).strict().superRefine((b, ctx) => {
  if (Date.parse(b.expiresAt) <= Date.parse(b.checkedAt)) ctx.addIssue({ code: 'custom', message: 'trial must not be expired when checked' });
  if (b.remainingRequests > b.requestLimit || b.remainingTokens > b.tokenLimit) ctx.addIssue({ code: 'custom', message: 'remaining capacity cannot exceed limits' });
  if (b.episodeCurrencyCapMicros > b.campaignCurrencyCapMicros || b.perRequestCostBoundMicros > b.episodeCurrencyCapMicros) ctx.addIssue({ code: 'custom', message: 'cost bound must fit episode and campaign caps' });
  if (b.maxInputTokens + b.maxOutputTokens > b.remainingTokens || b.remainingRequests < 1) ctx.addIssue({ code: 'custom', message: 'verified remaining capacity must support one bounded request' });
});
export const ProviderEvidenceSchema = z.object({
  provider: z.enum(['jev', 'zoom', 'zoom-pro']), status: z.enum(['not-verified', 'verified']), liveDispatchEnabled: z.boolean(),
  evidence: z.object({
    officialDocumentationUrl: z.string().url(), checkedAt: z.string().datetime(), sdkVersion: z.string().min(1),
    supportedRuntime: z.string().min(1), exactModelId: z.string().min(1), region: z.string().min(1), authenticationMethod: z.string().min(1),
    entitlementVerified: z.literal(true), semanticInputEquivalenceVerified: z.literal(true), responseSchemaVerified: z.literal(true),
    pricingSourceUrl: z.string().url(), retryCount: z.literal(0), deadlineMs: z.literal(4000),
    mockContractTestsPassed: z.literal(true), recoveryTestsPassed: z.literal(true), projectionTestsPassed: z.literal(true),
    credentialedSmokeRequestId: IdentifierSchema, legalSmokeAction: ActionSchema, verifier: z.string().min(1), budget: TrialBudgetSchema,
  }).strict().nullable(),
}).strict().superRefine((p, ctx) => {
  if (p.status === 'verified' && !p.evidence) ctx.addIssue({ code: 'custom', message: 'verified provider requires complete evidence' });
  if (p.status === 'not-verified' && (p.liveDispatchEnabled || p.evidence !== null)) ctx.addIssue({ code: 'custom', message: 'unverified adapter must remain disabled with no claimed verified evidence' });
});

export const AttemptRecordSchema = z.object({
  schemaVersion: z.literal('fallback-2'), runId: z.string().uuid(), tick: boundedInteger(0, 119), provider: z.enum(['jev', 'zoom', 'zoom-pro']),
  state: z.enum(['reserved', 'dispatch_intent', 'response_recorded', 'committed', 'uncertain', 'failed']),
  attemptCount: boundedInteger(0, 1), fencingToken: NonnegativeIntegerSchema, reservationId: IdentifierSchema,
  quotaPool: IdentifierSchema, reservedCostMicros: NonnegativeIntegerSchema, reservedRequests: z.literal(1),
  dispatchAt: NonnegativeIntegerSchema.nullable(), deadlineAt: NonnegativeIntegerSchema.nullable(), receivedAt: NonnegativeIntegerSchema.nullable(),
  monotonicDispatchMs: NonnegativeIntegerSchema.nullable(), response: DecisionResultSchema.nullable(),
  appliedAction: ActionSchema.nullable(), retryAllowed: z.literal(false), possibleChargeRetained: z.boolean(),
}).strict().superRefine((a, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (a.state === 'reserved') {
    if (a.attemptCount !== 0 || a.dispatchAt !== null || a.deadlineAt !== null || a.receivedAt !== null || a.monotonicDispatchMs !== null || a.response !== null || a.appliedAction !== null) issue('reservation cannot claim dispatch or result');
  } else if (a.attemptCount !== 1 || a.dispatchAt === null || a.deadlineAt !== a.dispatchAt + POC_CONFIG.decisionDeadlineMs || a.monotonicDispatchMs === null) issue('dispatch requires original bounded deadline and one attempt');
  if (a.receivedAt !== null && (a.dispatchAt === null || a.receivedAt < a.dispatchAt || a.deadlineAt === null || a.receivedAt > a.deadlineAt)) issue('recorded response must arrive within original deadline');
  if (a.response !== null && (a.receivedAt === null || a.response.provider !== a.provider)) issue('response requires matching provider and durable receipt timestamp');
  if (a.state === 'dispatch_intent' && (a.response !== null || a.receivedAt !== null || a.appliedAction !== null)) issue('dispatch intent cannot claim response or applied action');
  if (a.state === 'response_recorded' && a.response === null) issue('response_recorded needs durable response');
  if (a.state === 'uncertain' && (!a.possibleChargeRetained || a.response !== null)) issue('uncertain attempts retain potential charge without an accepted response');
  if (a.state === 'committed' && a.appliedAction === null) issue('committed attempt needs an applied action');
});
export type AttemptRecord = z.infer<typeof AttemptRecordSchema>;
export const RecoverySnapshotSchema = z.object({
  schemaVersion: z.literal('recovery-1'), runId: z.string().uuid(), sequence: NonnegativeIntegerSchema,
  contracts: ContractVersionsSchema, configurationHash: HashSchema, scheduleHash: HashSchema,
  simulatorStateHash: HashSchema, state: SimulatorStateSchema,
  scheduleReference: IdentifierSchema, privateIdMap: z.record(IdentifierSchema, IdentifierSchema),
  attempts: z.array(AttemptRecordSchema).max(360), reservationReferences: z.array(IdentifierSchema),
  operatorPaused: z.boolean(), voteRemainingMs: boundedInteger(0, 20_000).nullable(),
  fencingToken: NonnegativeIntegerSchema,
}).strict().superRefine((snapshot, ctx) => {
  if (snapshot.attempts.some((attempt) => attempt.runId !== snapshot.runId)) ctx.addIssue({ code: 'custom', message: 'snapshot attempts must belong to the same run' });
  const keys = snapshot.attempts.map((attempt) => `${attempt.tick}:${attempt.provider}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'snapshot attempt tick/provider keys must be unique' });
  if (snapshot.attempts.some((attempt) => attempt.tick > snapshot.state.tick)) ctx.addIssue({ code: 'custom', message: 'snapshot cannot reference future attempts' });
  if (snapshot.attempts.some((attempt) => attempt.fencingToken > snapshot.fencingToken)) ctx.addIssue({ code: 'custom', message: 'snapshot cannot contain an attempt from a future lease' });
});
