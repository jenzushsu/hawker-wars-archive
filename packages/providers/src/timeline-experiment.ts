import {DecisionInputSchema,type DecisionInput} from '../../shared/src/index.ts';
import {buildRequest,type WireProvider} from './wire.ts';
export const TIMELINE_EXPERIMENT_VERSION='tick63-timeline-1';
/** Diagnostic-only addition; production prompt and request builder remain unchanged. */
export function buildTick63TimelineRequest(provider:WireProvider,value:DecisionInput,model?:string){
 const input=DecisionInputSchema.parse(value),o=input.observation;
 if(input.tick!==63||o.rawPortions||o.readyBatches.length||o.cooking||o.pendingRestock||o.effects.length||JSON.stringify(input.legalActions)!==JSON.stringify(['RESTOCK','WAIT']))throw new Error('Timeline diagnostic requires the captured empty-pipeline tick-63 state');
 const request=buildRequest(provider,input,model,'hawker-decision-prompt-4');
 const timeline='Explicit timing for this observation: RESTOCK at tick 63 would deliver 20 raw portions at tick 73. If you then choose COOK at tick 73, 10 portions would become ready at tick 78, with 42 decision ticks remaining before closing at tick 120. These later actions are conditional choices, not automatic execution. WAIT at tick 63 starts no delivery or cooking; if you instead RESTOCK at tick 64 and COOK on delivery at tick 74, the first batch would be ready at tick 79. Evaluate the timing when choosing between the two legal actions.';
 if(provider==='jev'){
  const q=request.body.questions as {action:{instructions:string}};q.action.instructions+='\n'+timeline;
 }else{
  const q=request.body.questions as {instructions:string}[];q[0]!.instructions+='\n'+timeline;
 }
 return request;
}
