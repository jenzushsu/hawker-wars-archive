import {
  DecisionInputSchema, DecisionResultSchema, IdentifierSchema, NonnegativeIntegerSchema,
  POC_CONFIG, SCORE_CONFIG, DEMAND_CONFIG, type DecisionInput, type DecisionResult,
} from '../../shared/src/index.js';

export type WireProvider = 'jev' | 'zoom' | 'zoom-pro';
export const PROVIDER_PROMPT_VERSION = 'hawker-decision-prompt-2' as const;
export const ZOOM_ENDPOINT = 'https://api.zoom.us/v2/aiservices/decisions/decide';
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export interface WireRequest { endpoint: string; body: Record<string, unknown>; requestedModel: string }
export interface NativeUsage {
  schemaVersion: 'provider-native-usage-1';
  provider: WireProvider;
  inputUnits?: number;
  outputUnits?: number;
  unitType?: string;
  cachedInputTokens?: number;
}
export interface ParsedWireResponse { result: DecisionResult; nativeUsage?: NativeUsage }
export interface ProbabilityDiagnostic {
  shapeValid: boolean;
  missingLabels: DecisionInput['legalActions'];
  unexpectedLabelCount: number;
  duplicateLabelCount: number;
  invalidValueCount: number;
  sum: number | null;
}
/** Only legal enum labels and bounded aggregate numbers; never provider text. */
function probabilityFailure(input: DecisionInput, entries: readonly { action: unknown; probability: unknown }[], shapeValid = true): ProbabilityDiagnostic {
  const seen = new Set<string>();
  let unexpectedLabelCount = 0, duplicateLabelCount = 0, invalidValueCount = 0, sum = 0;
  for (const { action, probability } of entries) {
    if (typeof action !== 'string' || !input.legalActions.includes(action as DecisionResult['action'] & string)) unexpectedLabelCount++;
    else { if (seen.has(action)) duplicateLabelCount++; seen.add(action); }
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) invalidValueCount++;
    else sum += probability;
  }
  return { shapeValid, missingLabels: input.legalActions.filter(a => !seen.has(a)),
    unexpectedLabelCount, duplicateLabelCount, invalidValueCount,
    sum: shapeValid && invalidValueCount === 0 ? sum : null };
}
export class WireContractError extends Error {
  constructor(readonly code: 'invalid-input' | 'model-required' | 'invalid-model' | 'invalid-response' | 'illegal-action' | 'model-mismatch' | 'refusal' | 'invalid-usage' | 'invalid-probabilities' | 'late-response', readonly probabilityDiagnostic?: ProbabilityDiagnostic) {
    super(`Provider wire contract rejected (${code})`); this.name = 'WireContractError';
  }
}
export class ForcedWaitError extends Error {
  readonly code = 'forced-wait';
  constructor() { super('Sole WAIT is applied locally without a provider request'); this.name = 'ForcedWaitError'; }
}
const QUESTION_INSTRUCTIONS = 'Choose exactly one allowed action to maximize expected final utility at closing. Use the supplied observation and public game rules. Return the typed choice only; do not infer hidden schedules or seeds.';
const ACTION_RULES = Object.freeze({
  SERVE: 'Serve min(3, queue length, ready portions), FIFO; consume earliest-expiring ready portions; earn 500 cents each. No passive service.',
  COOK: 'One idle cooker takes 10 raw portions, reserves ready capacity and completes after 5 minutes; newly ready portions expire 20 minutes after completion.',
  RESTOCK: 'Pay 4000 cents for 20 raw portions; one pending order; delivery after 10 minutes or 15 during supplier delay; must arrive before closing.',
  PROMOTE: 'Pay 500 cents for extra arrival opportunities over next 10 ticks, with next activation at t+20; otherwise unchanged mechanics.',
  WAIT: 'Consume this turn without direct action; background arrivals, patience, spoilage and timers continue.',
});
/** Identical option descriptions accompany the question for every model. */
function choiceInstructions(input: DecisionInput): string {
  return [QUESTION_INSTRUCTIONS, 'Allowed actions and consequences:',
    ...input.legalActions.map(action => `${action}: ${ACTION_RULES[action]}`),
    'Consider delivery and cooking delays, remaining time, customer patience and closing inventory value. WAIT does not place an order, start cooking or serve customers.',
  ].join('\n');
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  throw new WireContractError('invalid-input');
}
function inputForWire(input: DecisionInput): DecisionInput {
  const checked = DecisionInputSchema.safeParse(input);
  if (!checked.success) throw new WireContractError('invalid-input');
  if (checked.data.legalActions.length === 1) throw new ForcedWaitError();
  return checked.data;
}
/** The same semantic context bytes are sent as Jev state and Zoom input. */
export function canonicalDecisionContext(input: DecisionInput): string {
  const checked = inputForWire(input);
  return canonicalJson({
    promptVersion: PROVIDER_PROMPT_VERSION,
    observation: checked.observation, legalActions: checked.legalActions,
    objective: { scorer: 'utility-1', maximize: 'finalUtilityPoints', formula: 'closingCashCents + 200*closingRawPortions - 28400 - 100*abandoned - 5*allResolvedCustomerWaitMinutes - 50*wastedReadyPortions', weights: SCORE_CONFIG },
    publicRules: {
      simulation: 'poc-1', demandVersion: 'demand-1', mechanics: POC_CONFIG, demandDefaults: DEMAND_CONFIG, actions: ACTION_RULES,
      tickOrder: ['external effects', 'ready expiry then deliveries/cooking completion', 'arrivals admitted before patience expiry', 'patience expiry at deadline', 'observation', 'one action', 'commit'],
      demand: { offPeakTicks: [[0, 29], [90, 119]], offPeakBaseCountMasses: { denominator: 4294967296, numerators: [2147483648, 1717986919, 429496729] }, peakTicks: [30, 89], peakBase: [{ count: 1, probability: 0.5 }, { count: 2, probability: 0.5 }], patience: { minimum: 3, maximum: 10, distribution: 'uniform' }, promotionExtra: { count: 1, probability: 0.5 }, effects: { bus: '6 arrivals at activation', rain: 'Keep each base arrival with probability 0.5 over 10 ticks; other sources unchanged', supplierDelay: 'Add 5 minutes once to pending order (clamp at119); new orders during10ticks take15 minutes' } },
      closing: 'At120 no arrivals or decisions; resolve every queued customer as abandoned, charge wait, discard remaining ready stock once, retain raw at200 cents; no in-flight stock.',
    },
  });
}
function selectedModel(provider: WireProvider, jevModel?: string): string {
  if (provider !== 'jev' && provider !== 'zoom' && provider !== 'zoom-pro') throw new WireContractError('invalid-model');
  if (provider === 'zoom') return 'zoom-decisions-standard';
  if (provider === 'zoom-pro') return 'zoom-decisions-pro';
  if (!jevModel) throw new WireContractError('model-required');
  if (!IdentifierSchema.safeParse(jevModel).success) throw new WireContractError('invalid-model');
  return jevModel;
}
export function buildRequest(provider: WireProvider, input: DecisionInput, jevModel?: string): WireRequest {
  const checked = inputForWire(input), requestedModel = selectedModel(provider, jevModel);
  const context = canonicalDecisionContext(checked);
  const instructions = choiceInstructions(checked);
  if (provider === 'jev') {
    return { endpoint: JEV_ENDPOINT, requestedModel, body: { model: requestedModel, state: context, questions: { action: { type: 'choice', instructions, criteria: Object.fromEntries(checked.legalActions.map(action => [action, null])) } } } };
  }
  return { endpoint: ZOOM_ENDPOINT, requestedModel, body: { model: requestedModel, input: context, questions: [{ name: 'action', type: 'choice', instructions, choices: checked.legalActions.map(value => ({ value })) }] } };
}
function record(value: unknown, code: 'invalid-response' | 'invalid-usage' = 'invalid-response'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WireContractError(code);
  return value as Record<string, unknown>;
}
function safeId(value: unknown): string {
  if (!IdentifierSchema.safeParse(value).success) throw new WireContractError('invalid-response');
  return value as string;
}
function count(value: unknown): number {
  if (!NonnegativeIntegerSchema.safeParse(value).success) throw new WireContractError('invalid-usage');
  return value as number;
}
function normalizedProbabilities(input: DecisionInput, entries: readonly { action: unknown; probability: unknown }[]): NonNullable<DecisionResult['probabilities']> {
  const diagnostic = probabilityFailure(input, entries);
  if (diagnostic.missingLabels.length || diagnostic.unexpectedLabelCount || diagnostic.duplicateLabelCount || diagnostic.invalidValueCount || diagnostic.sum === null || Math.abs(diagnostic.sum - 1) > 0.000001) {
    throw new WireContractError('invalid-probabilities', diagnostic);
  }
  const probabilities = new Map(entries.map(({action, probability}) => [action as string, probability as number]));
  return input.legalActions.map(action => ({ action, probability: probabilities.get(action)! }));
}
export function parseResponse(provider: WireProvider, input: DecisionInput, requestedModel: string, raw: unknown, latencyMs: number): ParsedWireResponse {
  const checked = inputForWire(input);
  if (!NonnegativeIntegerSchema.safeParse(latencyMs).success) throw new WireContractError('invalid-response');
  if (latencyMs > 4000) throw new WireContractError('late-response');
  const expectedRequest = selectedModel(provider, provider === 'jev' ? requestedModel : undefined);
  if (requestedModel !== expectedRequest) throw new WireContractError('model-mismatch');
  const body = record(raw), model = safeId(body.model);
  const allowedModels = provider === 'zoom' ? ['zoom-decisions-standard', 'zoom-decisions'] : [requestedModel];
  if (!allowedModels.includes(model)) throw new WireContractError('model-mismatch');
  let answer: Record<string, unknown>;
  if (provider === 'jev') {
    const answers = record(body.answers);
    if (Object.keys(answers).length !== 1 || !Object.hasOwn(answers, 'action')) throw new WireContractError('invalid-response');
    answer = record(answers.action);
  } else {
    if (!Array.isArray(body.answers) || body.answers.length !== 1) throw new WireContractError('invalid-response');
    answer = record(body.answers[0]);
    if (answer.name !== 'action') throw new WireContractError('invalid-response');
  }
  if (answer.type === 'refusal') throw new WireContractError('refusal');
  if (answer.type !== 'choice') throw new WireContractError('invalid-response');
  if (typeof answer.choice !== 'string' || !checked.legalActions.includes(answer.choice as DecisionResult['action'] & string)) throw new WireContractError('illegal-action');
  const result: DecisionResult = { provider, status: 'success', action: answer.choice as DecisionResult['action'], latencyMs, modelVersion: model };
  if (body.request_id !== undefined) result.requestId = safeId(body.request_id);
  if (answer.probabilities !== undefined) {
    let entries: {action: unknown; probability: unknown}[];
    try {
      entries = provider === 'jev'
        ? Object.entries(record(answer.probabilities)).map(([action, probability]) => ({action, probability}))
        : (() => { if (!Array.isArray(answer.probabilities)) throw new Error(); return answer.probabilities.map(value => { const p = record(value); return {action:p.value, probability:p.probability}; }); })();
    } catch {
      throw new WireContractError('invalid-probabilities', probabilityFailure(checked, [], false));
    }
    result.probabilities = normalizedProbabilities(checked, entries);
    result.probabilitySemantics = provider === 'jev' ? 'Provider-reported per-label choice probabilities per @typesafe-ai/sdk@0.7.0; no cross-provider calibration claim.' : 'Provider-reported probability of each allowed choice per official Zoom Decisions contract; no cross-provider calibration claim.';
  }
  if (provider === 'jev' && answer.confidence !== undefined) {
    if (typeof answer.confidence !== 'number' || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) throw new WireContractError('invalid-response');
    result.confidence = answer.confidence;
    result.confidenceSemantics = 'Provider-reported confidence in selected label per @typesafe-ai/sdk@0.7.0; not claimed calibrated.';
  }
  let nativeUsage: NativeUsage | undefined;
  if (body.usage !== undefined) {
    const usage = record(body.usage, 'invalid-usage'); nativeUsage = { schemaVersion: 'provider-native-usage-1', provider };
    if (provider === 'jev') {
      const generic: NonNullable<DecisionResult['usage']> = {};
      if (usage.input_tokens !== undefined && usage.input_tokens !== null) { const value = count(usage.input_tokens); nativeUsage.inputUnits = value; generic.inputTokens = value; }
      if (usage.output_tokens !== undefined && usage.output_tokens !== null) { const value = count(usage.output_tokens); nativeUsage.outputUnits = value; generic.outputTokens = value; }
      nativeUsage.unitType = 'tokens';
      if (Object.keys(generic).length) result.usage = generic;
    } else {
      nativeUsage.inputUnits = count(usage.input_units); nativeUsage.outputUnits = count(usage.output_units);
      nativeUsage.unitType = safeId(usage.unit_type);
      if (usage.details !== undefined) {
        const details = record(usage.details, 'invalid-usage');
        if (details.cached_input_tokens !== undefined) nativeUsage.cachedInputTokens = count(details.cached_input_tokens);
      }
    }
  }
  const parsed = DecisionResultSchema.safeParse(result);
  if (!parsed.success) throw new WireContractError('invalid-response');
  return nativeUsage ? { result: parsed.data, nativeUsage } : { result: parsed.data };
}
