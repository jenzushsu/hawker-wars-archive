import {DecisionInputSchema,type DecisionInput} from '../../shared/src/index.ts';
import {effectiveRestockDueTick} from '../../simulation/src/legality.ts';
import {buildRequest,type WireProvider} from './wire.ts';
export const PIPELINE_EXPERIMENT_VERSION='pipeline-guidance-validation-1';
export function pipelineGuidance(value:DecisionInput):string{
 const input=DecisionInputSchema.parse(value),o=input.observation;
 if(!input.legalActions.includes('RESTOCK'))throw new Error('Diagnostic requires a legal restock option');
 const delivery=effectiveRestockDueTick(o),ready=delivery+5;
 const current=o.cooking?`A batch is already cooking and is due at tick ${o.cooking.dueTick}; evaluate this existing work separately from a new order.`:'There is no batch currently cooking.';
 const timing=ready<120
  ? `RESTOCK now at tick ${input.tick} delivers 20 raw portions at tick ${delivery}. If you choose COOK on delivery with an idle cooker and available capacity, the earliest new ten-portion batch is ready at tick ${ready}, leaving ${120-ready} decision ticks before closing. These follow-up actions are conditional, not automatic.`
  : `RESTOCK now at tick ${input.tick} delivers at tick ${delivery}. Adding the five-tick cooking delay reaches tick ${ready}, so this new order cannot be cooked and served before closing at tick 120. Uncooked raw stock is salvaged at 200 cents per portion, equal to its purchase price per portion.`;
 const expired=o.queue.filter(c=>c.deadlineTick<=ready).length;
 const demand=ready<120
  ? `${expired} of ${o.queue.length} currently queued customers expire before this newly ordered batch could serve them. This does not mean later customers stop arriving. Evaluate expected final utility from later arrivals during the remaining service window using public demand rates, not only whether this current queue can be rescued. Consider any existing ready stock or cooking separately.`
  : 'Do not assume future arrivals justify a new order when its food cannot be ready before closing. Compare remaining legal actions using final utility and inventory settlement.';
 return ['Explicit pipeline timing:',current,timing,demand,'Future arrivals are uncertain; do not infer the hidden schedule. Choose only the next legal action.'].join(' ');
}
export function buildPipelineGuidanceRequest(provider:WireProvider,value:DecisionInput,model?:string){
 const request=buildRequest(provider,value,model,'hawker-decision-prompt-4'),note=pipelineGuidance(value);
 if(provider==='jev')(request.body.questions as {action:{instructions:string}}).action.instructions+='\n'+note;
 else (request.body.questions as {instructions:string}[])[0]!.instructions+='\n'+note;
 return request;
}
