import {DecisionInputSchema,POC_CONFIG,type DecisionInput} from '../../shared/src/index.ts';
import {actionCriteriaInstructions} from './action-criteria-experiment.ts';
import {buildRequest,type WireProvider} from './wire.ts';
export const ACTION_CRITERIA_V2_VERSION='action-criteria-prompt-2';
/** Retain the historical v1 builder byte-for-byte for recorded request verification. */
export function actionCriteriaV2Instructions(value:DecisionInput){
 const input=DecisionInputSchema.parse(value),o=input.observation;
 const lines=[actionCriteriaInstructions(input).replace(
  'WAIT: Use when work progresses, delay avoids waste, or other actions offer no expected utility gain. WAIT cannot replenish stock.',
  'WAIT: Compare waiting with useful actions available now; background work progresses during any action. Wait when delay avoids waste or alternatives offer no expected utility gain. WAIT cannot replenish stock.'),
  'A pending delivery does not prevent cooking raw stock already on hand. Do not wait solely because a delivery is approaching.'];
 if(input.legalActions.includes('COOK')){
  const readyAt=input.tick+POC_CONFIG.cookingMinutes;
  lines.push(`COOK now uses ${POC_CONFIG.cookBatchSize} available raw portions and finishes at tick ${readyAt}.`);
  if(o.pendingRestock){
   const later=o.pendingRestock.dueTick+POC_CONFIG.cookingMinutes;
   lines.push(`Waiting until the scheduled delivery at ${o.pendingRestock.dueTick}, then choosing COOK, would finish at ${later}, assuming legality, capacity and no additional delay.${later>=POC_CONFIG.closingTick?' That is too late to serve before closing.':''}`);
  }
  lines.push(`${o.queue.filter(c=>c.deadlineTick<=readyAt).length} of ${o.queue.length} queued customers expire by tick ${readyAt}; deadlines equal to the ready tick expire before service. Later deadlines do not guarantee service. Consider future demand and spoilage too.`);
 }else lines.push('COOK is not currently legal; do not assume existing ingredients can start a batch now.');
 return lines.join('\n');
}
/** Prompt-only candidate; no dispatch, action selection or safeguard. */
export function buildActionCriteriaV2Request(provider:WireProvider,input:DecisionInput,model?:string){
 const request=buildRequest(provider,input,model),instructions=actionCriteriaV2Instructions(input);
 if(provider==='jev')(request.body.questions as {action:{instructions:string}}).action.instructions=instructions;
 else (request.body.questions as {instructions:string}[])[0]!.instructions=instructions;
 return request;
}
