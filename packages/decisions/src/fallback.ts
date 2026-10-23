import {
  ActionSchema, DecisionInputSchema, DecisionResultSchema, LegalActionsSchema, NonnegativeIntegerSchema,
  type DecisionInput, type DecisionResult,
} from '../../shared/src/schemas.js';
import { CONTRACT_VERSIONS, POC_CONFIG } from '../../shared/src/config.js';
import { chooseRules, type Action, type RulesState } from './rules.js';
import type { MockController, MockOutcome } from './mock.js';

export type AttemptedProvider = 'jev' | 'zoom' | 'zoom-pro';
export type FallbackReason = NonNullable<DecisionResult['fallbackReason']>;
export interface TurnOutcome {
  mode: 'offline'; origin: 'rules'|'mock'|'fallback'|'forced_wait';
  attemptedProvider: AttemptedProvider|'rules'|null;
  proposedAction: Action|null; appliedAction: Action;
  providerStatus: 'success'|'error'|'not-called'; applicationStatus: 'success'|'fallback'|'forced_wait';
  appliedPolicy: AttemptedProvider|'rules'|'forced_wait';
  baselineVersion: 'rules-1'; failurePolicyVersion: 'fallback-2';
  rulePriority: number|null; latencyMs: number; attemptCount: 0|1;
  fallbackReason: FallbackReason|null; diagnostic: string|null;
  appliedResult: DecisionResult|null;
}
const versions = { baselineVersion: CONTRACT_VERSIONS.baseline, failurePolicyVersion: CONTRACT_VERSIONS.failurePolicy } as const;
function forcedWait(): TurnOutcome {
  return {mode:'offline',origin:'forced_wait',attemptedProvider:null,proposedAction:null,appliedAction:'WAIT',providerStatus:'not-called',applicationStatus:'forced_wait',appliedPolicy:'forced_wait',...versions,rulePriority:null,latencyMs:0,attemptCount:0,fallbackReason:null,diagnostic:null,appliedResult:null};
}
function rawAction(response: unknown): Action|null {
  if (!response || typeof response !== 'object') return null;
  const parsed = ActionSchema.safeParse((response as Record<string,unknown>).action);
  return parsed.success ? parsed.data : null;
}
function fallback(state: RulesState, legal: readonly Action[], provider: AttemptedProvider, latencyMs:number, reason:FallbackReason, diagnostic:string, proposedAction:Action|null):TurnOutcome {
  const rule=chooseRules(state,legal);
  const appliedResult=DecisionResultSchema.parse({provider,action:proposedAction,status:'fallback',latencyMs,appliedAction:rule.action,fallbackReason:reason,fallbackPolicy:'rules-1'});
  return {mode:'offline',origin:'fallback',attemptedProvider:provider,proposedAction,appliedAction:rule.action,providerStatus:'error',applicationStatus:'fallback',appliedPolicy:'rules',...versions,rulePriority:rule.rulePriority,latencyMs,attemptCount:1,fallbackReason:reason,diagnostic,appliedResult};
}

/** Pure result resolution. Input is an already captured decision boundary, including test-local openings. */
export function resolveMockOutcome(context:{state:RulesState;legalActions:readonly Action[];provider:AttemptedProvider;outcome:unknown}):TurnOutcome {
  const legal=LegalActionsSchema.parse(context.legalActions);
  if (legal.length===1) return forcedWait();
  const {state,provider}=context;
  const raw=context.outcome;
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) return fallback(state,legal,provider,0,'invalid','invalid_mock_outcome',null);
  const envelope=raw as Record<string,unknown>;
  const kind=envelope.kind;
  const allowedKeys=kind==='response'?['kind','response','elapsedMs']:['kind','reason','elapsedMs'];
  if ((kind!=='response' && kind!=='failure') || Object.keys(envelope).some(key=>!allowedKeys.includes(key)) ||
      (kind==='response' && !Object.hasOwn(envelope,'response')) ||
      (kind==='failure' && !['network','rate-limit','timeout'].includes(String(envelope.reason)))) {
    return fallback(state,legal,provider,0,'invalid','invalid_mock_outcome',null);
  }
  const outcome=raw as MockOutcome;
  let latencyMs:number;
  try { latencyMs=NonnegativeIntegerSchema.parse(outcome.elapsedMs); }
  catch { return fallback(state,legal,provider,0,'invalid','invalid_elapsed_time',null); }
  const proposed=outcome.kind==='response'?rawAction(outcome.response):null;
  if (latencyMs>POC_CONFIG.decisionDeadlineMs) return fallback(state,legal,provider,latencyMs,'timeout','late_response',proposed);
  if (outcome.kind==='failure') return fallback(state,legal,provider,latencyMs,outcome.reason,outcome.reason,null);
  const result=DecisionResultSchema.safeParse(outcome.response);
  if (!result.success || result.data.provider!==provider) return fallback(state,legal,provider,latencyMs,'invalid','invalid_response',proposed);
  const response=result.data;
  if (response.status!=='success') return fallback(state,legal,provider,latencyMs,'network','provider_error',proposed);
  if (response.action===null || !legal.includes(response.action)) return fallback(state,legal,provider,latencyMs,'illegal','illegal_action',proposed);
  if (response.probabilities?.some(entry=>!legal.includes(entry.action))) return fallback(state,legal,provider,latencyMs,'invalid','invalid_probability_actions',proposed);
  const appliedResult=DecisionResultSchema.parse({...response,latencyMs});
  return {mode:'offline',origin:'mock',attemptedProvider:provider,proposedAction:response.action,appliedAction:response.action,providerStatus:'success',applicationStatus:'success',appliedPolicy:provider,...versions,rulePriority:null,latencyMs,attemptCount:1,fallbackReason:null,diagnostic:null,appliedResult};
}

export type OfflineDecisionOptions = {mode:'rules'}|{mode:'mock';provider:AttemptedProvider;controller:MockController};
/** Only rules or explicit synchronous mock scripts can run here; no live adapter is instantiated. */
export function decideOffline(input:DecisionInput,options:OfflineDecisionOptions={mode:'rules'}):TurnOutcome {
  const captured=DecisionInputSchema.parse(input);
  if (captured.legalActions.length===1) return forcedWait();
  if (options.mode==='rules') {
    const rule=chooseRules(captured.observation,captured.legalActions);
    const appliedResult=DecisionResultSchema.parse({provider:'rules',action:rule.action,status:'success',latencyMs:0,modelVersion:'rules-1'});
    return {mode:'offline',origin:'rules',attemptedProvider:'rules',proposedAction:rule.action,appliedAction:rule.action,providerStatus:'success',applicationStatus:'success',appliedPolicy:'rules',...versions,rulePriority:rule.rulePriority,latencyMs:0,attemptCount:0,fallbackReason:null,diagnostic:null,appliedResult};
  }
  let outcome:MockOutcome;
  try { outcome=options.controller(structuredClone(captured)); }
  catch { outcome={kind:'failure',reason:'network',elapsedMs:0}; }
  // Controllers receive a clone: mutation cannot change the captured observation or fallback legal set.
  return resolveMockOutcome({state:captured.observation,legalActions:captured.legalActions,provider:options.provider,outcome});
}
