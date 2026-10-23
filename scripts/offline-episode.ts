import { createHash, randomUUID } from 'node:crypto';
import { createInitialFrame, prepareTick, applyAction, advanceTick, settle, assertFrame } from '../packages/simulation/src/engine.js';
import { createDemandSchedule, arrivalsAt, toEngineArrival, eventAt, type DemandScenario } from '../packages/simulation/src/demand.js';
import { decisionInput } from '../packages/simulation/src/observation.js';
import { stateHash, canonicalState } from '../packages/simulation/src/hash.js';
import { episodeMetrics, scoreState } from '../packages/simulation/src/scoring.js';
import type { CustomerResolution, EngineFrame } from '../packages/simulation/src/types.js';
import type { Observation, DecisionInput } from '../packages/shared/src/index.js';
import { decideOffline, type TurnOutcome } from '../packages/decisions/src/index.js';
import { configurationHash } from './config-snapshot.js';

export interface EpisodeOptions { seed:number;scenario?:DemandScenario;policy?:'rules'|'mixed';roundId?:string;metadata?:Record<string,unknown> }
export interface EpisodeTurn {tick:number;input:DecisionInput;observation:Observation;decision:TurnOutcome;preparedHash:string;hash:string}
/** Offline integration only. No SDK/HTTP clients or hosted services are imported. */
export function runEpisode(options:EpisodeOptions) {
  if(!Number.isInteger(options.seed)||options.seed<0||options.seed>99)throw new Error('Offline development runner accepts seeds 0–99 only');
  const scenario=options.scenario??'clean',policy=options.policy??'rules';
  if(policy!=='rules'&&policy!=='mixed')throw new Error('Unsupported offline policy');
  const schedule=createDemandSchedule(options.seed,scenario);
  const roundId=options.roundId??randomUUID();
  let frame=createInitialFrame(),recentActions:Observation['recentActions']=[],stockoutTicks=0;
  const resolutions:CustomerResolution[]=[],trace:EpisodeTurn[]=[];
  const countEvents=(current:EngineFrame)=>{for(const event of current.events)if(event.type==='customer-resolved')resolutions.push(event);};
  const hash=()=>stateHash({frame,scheduleHash:schedule.hash,scenario,configurationHash,recentActions});
  for(let tick=0;tick<120;tick++){
    if(frame.boundaryTick!==tick||frame.stage!=='before-tick')throw new Error('Episode tick drift');
    const p=frame.state.promotion;
    const promotionActive=!!p&&p.startsAt<=tick&&p.endsAt>=tick;
    const event=eventAt(schedule,tick);
    const arrivals=arrivalsAt(schedule,tick,promotionActive).map(toEngineArrival);
    frame=prepareTick(frame,event?{arrivals,event}:{arrivals});countEvents(frame);assertFrame(frame);
    const input=decisionInput(frame.state,roundId,recentActions);
    if(frame.state.queue.length>0&&frame.state.readyBatches.length===0)stockoutTicks++;
    const preparedHash=hash();
    const decision=policy==='rules'?decideOffline(input,{mode:'rules'}):decideOffline(input,{mode:'mock',provider:'jev',controller:(captured)=>{
      const r=createHash('sha256').update(`hawker-wars|mixed-actions-1|${options.seed}|${tick}`).digest().readUInt32BE(0);
      const action=captured.legalActions[r%captured.legalActions.length]!;
      return {kind:'response',elapsedMs:0,response:{provider:'jev',action,latencyMs:0,status:'success'}};
    }});
    frame=applyAction(frame,decision.appliedAction);countEvents(frame);assertFrame(frame);
    recentActions=[...recentActions,{tick,action:decision.appliedAction}].slice(-5);
    trace.push({tick,input,observation:input.observation,decision,preparedHash,hash:hash()});
    frame=advanceTick(frame);assertFrame(frame);
  }
  frame=settle(frame);countEvents(frame);assertFrame(frame);
  const finalHash=hash(),score=scoreState(frame.state,resolutions),metrics=episodeMetrics(frame.state,resolutions,stockoutTicks);
  const traceHash=createHash('sha256').update('hawker-wars|offline-trace-1\n').update(canonicalState({scheduleHash:schedule.hash,policy,turns:trace.map(t=>({tick:t.tick,action:t.decision.appliedAction,preparedHash:t.preparedHash,hash:t.hash})),finalHash})).digest('hex');
  return {mode:'offline' as const,policy,seed:options.seed,scenario,completed:true as const,scheduleHash:schedule.hash,configurationHash,trace,resolutions,finalState:frame.state,score,metrics,finalHash,traceHash,networkCalls:0 as const,metadata:options.metadata??{}};
}
export type EpisodeResult=ReturnType<typeof runEpisode>;
