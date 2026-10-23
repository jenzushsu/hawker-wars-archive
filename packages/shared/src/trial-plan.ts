import { z } from 'zod';
import { ContractVersionsSchema, HashSchema, NonnegativeIntegerSchema } from './schemas.js';
import { TRIAL_CONFIG } from './config.js';

const seeds = (expected: readonly number[]) => z.array(NonnegativeIntegerSchema).refine(a => JSON.stringify(a)===JSON.stringify(expected), 'Frozen evaluation seed sequence differs');
const disabled = z.object({ verification:z.literal('unverified'), liveEnabled:z.literal(false), modelId:z.null() }).strict();
/** Planned campaign artifact only; this schema cannot authorize live execution. */
export const TrialEvaluationPlanSchema = z.object({
 manifestId:z.literal('trial-eval-1-p0'),manifestVersion:z.literal('trial-eval-1'),status:z.literal('planned-not-executed'),
 contracts:ContractVersionsSchema,configurationHash:HashSchema,referenceChecksum:z.null(),referenceChecksumStatus:z.literal('pending-P2-engine-reference'),
 sourceRevision:z.string().regex(/^[a-f0-9]{40}$/).nullable(),sourceRevisionStatus:z.literal('pending-first-commit'),runtimeLockStatus:z.literal('P0-toolchain-pinned-separately'),
 liveDispatchEnabled:z.literal(false),providerPolicy:z.object({jev:disabled,zoom:disabled,'zoom-pro':disabled,rules:z.object({verification:z.literal('not-required'),liveEnabled:z.literal(false),networkRequired:z.literal(false),baselineVersion:z.literal('rules-1')}).strict()}).strict(),
 budget:z.object({currency:z.null(),perRunCapMinorUnits:z.null(),campaignCapMinorUnits:z.null(),verifiedTrialCapacity:z.null(),verifiedTrialExpiresAt:z.null(),sharedQuotaPools:z.array(z.never()).length(0),automaticUpgradeAllowed:z.literal(false),paidOveragesAllowed:z.literal(false),missingBudgetOrQuotaAllowsDispatch:z.literal(false),smokeAndStaticBudgetRequiredSeparately:z.literal(true)}).strict(),
 requestPolicy:z.object({deadlineMs:z.literal(4000),automaticRetriesPerTick:z.literal(0),maxAttemptsPerEpisodePerProvider:z.literal(120),uncertainAttemptRedispatchAllowed:z.literal(false),reserveCostAndQuotaBeforeDispatch:z.literal(true)}).strict(),
 cohorts:z.object({
  clean:z.object({classification:z.literal('controlled-clean'),seeds:seeds(TRIAL_CONFIG.cleanSeeds),targetPairedSeeds:z.literal(30),audienceVoting:z.literal(false),shock:z.null(),completionSubjectToVerifiedTrialCapacity:z.literal(true),maximumRequestsPerLiveProvider:z.literal(3600)}).strict(),
  stress:z.object({classification:z.literal('exploratory-stress'),seeds:seeds(TRIAL_CONFIG.stressSeeds),maximumPairedSeeds:z.literal(6),audienceVoting:z.literal(false),shockTick:z.literal(60),eventBySeedModulo3:z.object({'0':z.literal('bus'),'1':z.literal('rain'),'2':z.literal('supplier-delay')}).strict(),
   stages:z.tuple([z.object({stage:z.literal(1),seeds:seeds(TRIAL_CONFIG.stressStages[0]!)}).strict(),z.object({stage:z.literal(2),seeds:seeds(TRIAL_CONFIG.stressStages[1]!),requiresRemainingReservedQuota:z.literal(true)}).strict()]),continuationMayDependOnScores:z.literal(false),maximumRequestsPerLiveProvider:z.literal(720),reporting:z.literal('descriptive-per-seed-and-event-no-robust-ranking-claim')}).strict(),
 }).strict(),
 seedSplits:z.object({sequentialDevelopment:seeds(TRIAL_CONFIG.developmentSeeds),staticDevelopmentGenerator:seeds(TRIAL_CONFIG.staticDevelopmentSeeds),staticHeldOutGenerator:seeds(TRIAL_CONFIG.staticHeldOutSeeds),deduplicateCanonicalStaticStatesAcrossSplits:z.literal(true),futureResearchSeeds:z.object({first:z.literal(1000),last:z.literal(1099),enabled:z.literal(false),requiresAdditionalCapacity:z.literal(true)}).strict()}).strict(),
 requestCeilings:z.object({cleanPerLiveProvider:z.literal(3600),stressPerLiveProvider:z.literal(720),combinedPerLiveProvider:z.literal(4320),combinedThreeLiveProviders:z.literal(12960),includesSmokeOrStatic:z.literal(false),rulesPaidRequests:z.literal(0),forcedWaitRequiresProviderCall:z.literal(false)}).strict(),
 reporting:z.object({keepCohortsSeparate:z.literal(true),retainFailuresAndFallbacks:z.literal(true),reportUnavailableAdapters:z.literal(true),reportActualPairedCounts:z.literal(true),cleanUncertainty:z.object({method:z.literal('paired-seed-cluster-bootstrap'),resamples:z.literal(10000),analysisSeed:z.literal(424242),confidencePercent:z.literal(95),interval:z.literal('percentile')}).strict(),stressUncertainty:z.literal('descriptive-only')}).strict(),
}).strict();
export type TrialEvaluationPlan = z.infer<typeof TrialEvaluationPlanSchema>;
