import {DecisionInputSchema,type DecisionInput} from '../../shared/src/index.ts';
import type {WireProvider} from './wire.ts';
import {buildTick63TimelineRequest} from './timeline-experiment.ts';
export const FUTURE_DEMAND_EXPERIMENT_VERSION='tick63-future-demand-1';
/** Diagnostic-only addition to the timeline treatment, without future schedule access. */
export function buildTick63FutureDemandRequest(provider:WireProvider,value:DecisionInput,model?:string){
 const input=DecisionInputSchema.parse(value);
 if(input.observation.queue.length!==4||input.observation.queue.some(c=>c.deadlineTick>=78))throw new Error('Diagnostic requires the captured expiring queue');
 const request=buildTick63TimelineRequest(provider,input,model);
 const note='Distinguish the current queue from future demand: all four customers currently waiting have patience deadlines before tick 78, so a newly ordered and cooked batch cannot save them. This does not mean future customers stop arriving. Stock made ready at tick 78 can serve later arrivals during the remaining peak ticks 78-89 and off-peak ticks 90-119. Evaluate expected final utility using the supplied public arrival rates across those future ticks, not only whether the current queue can be rescued. Future arrivals are uncertain; do not infer the hidden schedule or assume follow-up actions execute automatically.';
 if(provider==='jev')(request.body.questions as {action:{instructions:string}}).action.instructions+='\n'+note;
 else (request.body.questions as {instructions:string}[])[0]!.instructions+='\n'+note;
 return request;
}
