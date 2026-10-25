import {DecisionInputSchema,POC_CONFIG,type DecisionInput} from '../../shared/src/index.ts';
import {effectiveRestockDueTick,getLegalActions} from '../../simulation/src/legality.ts';
import {buildRequest,type WireProvider} from './wire.ts';
export const ACTION_CRITERIA_VERSION='action-criteria-prompt-1';
const CRITERIA=[
 'Choose one legal action to maximize final utility at tick 120 using the supplied rules. Return the typed choice; do not infer hidden arrivals.',
 'Evaluate ready food, cooking, raw stock and pending delivery together.',
 'SERVE: Prioritize waiting customers when food is ready; delay risks abandonment or spoilage.',
 'COOK: Consider cooking when ready supply is insufficient for expected demand; account for completion time and spoilage.',
 'RESTOCK: Consider replenishment before supply runs out. An empty pipeline needs an order. Consider arrivals after delivery/cooking, not only the current queue. Repeat orders are allowed.',
 'WAIT: Use when work progresses, delay avoids waste, or other actions offer no expected utility gain. WAIT cannot replenish stock.',
 'PROMOTE: Consider extra demand when supply and service capacity can support it.',
 'Account for closing salvage and penalties. Follow-up actions are not automatic. Tables use named columns; queue rows are FIFO.',
].join('\n');
export function actionCriteriaInstructions(value:DecisionInput){
 const input=DecisionInputSchema.parse(value),o=input.observation,ready=o.readyBatches.reduce((n,b)=>n+b.quantity,0);
 if(JSON.stringify(input.legalActions)!==JSON.stringify(getLegalActions(o)))throw new Error('Captured legality mismatch');
 const empty=o.rawPortions===0&&ready===0&&!o.cooking&&!o.pendingRestock;
 const lines=[CRITERIA,`Pipeline: ${empty?'EMPTY':'NONEMPTY'}; raw=${o.rawPortions}; ready=${ready}; cookingDue=${o.cooking?.dueTick??'none'}; deliveryDue=${o.pendingRestock?.dueTick??'none'}.`];
 if(input.legalActions.includes('RESTOCK')){
  const due=effectiveRestockDueTick(o),earliest=due+POC_CONFIG.cookingMinutes;
  lines.push(`RESTOCK now: delivery at ${due}; optimistic earliest new food at ${earliest}, assuming COOK on delivery, idle cooker, capacity and no additional delay. Remaining service ticks: ${Math.max(0,120-earliest)}.`);
  if(earliest>=120)lines.push('This new order cannot be cooked and served before closing; raw salvage equals its purchase price.');
 }else lines.push('RESTOCK is not currently legal; do not assume an order can be placed now.');
 if(empty)lines.push('WAIT leaves the pipeline empty.');
 return lines.join('\n');
}
/** Experimental request only: no action override, live worker unchanged. */
export function buildActionCriteriaRequest(provider:WireProvider,input:DecisionInput,model?:string){
 const request=buildRequest(provider,input,model),instructions=actionCriteriaInstructions(input);
 if(provider==='jev')(request.body.questions as {action:{instructions:string}}).action.instructions=instructions;
 else (request.body.questions as {instructions:string}[])[0]!.instructions=instructions;
 return request;
}
