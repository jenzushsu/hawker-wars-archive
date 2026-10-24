import type {DecisionInput} from '../../shared/src/index.js';
import {buildRequest, type WireProvider, type WireRequest} from './wire.js';

/** Labels identify fixed conditional plans, not production single-action choices. */
export function buildShortPlanRequest(provider:WireProvider,input:DecisionInput,jevModel:string):WireRequest {
  if (input.legalActions.join(',') !== 'RESTOCK,WAIT' || input.observation.rawPortions || input.observation.readyBatches.length || input.observation.cooking || input.observation.pendingRestock) throw new Error('Short-plan experiment requires an empty pipeline and RESTOCK/WAIT');
  const request = buildRequest(provider,input,jevModel);
  const plans = {
    RESTOCK:'Order 20 raw portions now for 4000 cents. Wait for delivery. Then cook one batch of 10 whenever the cooker is idle, at least 10 raw portions remain, ready capacity permits and completion is before closing. Serve whenever ready food and queued customers coexist, prioritizing SERVE over COOK. Otherwise WAIT. Place no further orders and do not promote. Retain unused raw stock at closing.',
    WAIT:'Wait for 10 turns without ordering, cooking, serving or promoting. Then order 20 raw portions for 4000 cents if RESTOCK is still legal; otherwise wait until closing. After that order, follow exactly the same delivery, cooking, serving and closing rules as the RESTOCK plan. Place no further orders and do not promote.',
  };
  const instructions = [
    'Choose the complete conditional plan with the highest expected final utility, not merely the most attractive immediate action. The answer labels RESTOCK and WAIT identify the two plans below.',
    'Use the supplied state, public demand rates, costs, delays, patience and closing rules. Consider future customers as well as the current queue. Do not infer hidden future arrivals. If plans have equal expected utility, either answer is acceptable.',
    ...Object.entries(plans).map(([label,description])=>`${label}: ${description}`),
    'Return exactly one typed choice. No plan will be executed in this diagnostic experiment.',
  ].join('\n');
  if(provider==='jev') {
    const question=(request.body.questions as {action:{instructions:string;criteria:Record<string,unknown>}}).action;
    question.instructions=instructions; question.criteria=plans;
  } else (request.body.questions as {instructions:string}[])[0]!.instructions=instructions;
  return request;
}
