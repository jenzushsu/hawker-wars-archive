import {createInitialFrame,prepareTick,applyAction,advanceTick,settle} from '../packages/simulation/src/engine.ts';
import {createDemandSchedule,arrivalsAt,toEngineArrival,eventAt} from '../packages/simulation/src/demand.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
import {scoreState} from '../packages/simulation/src/scoring.ts';
import {chooseRules} from '../packages/decisions/src/rules.ts';
import {proposeRestockRecovery} from '../packages/decisions/src/restock-recovery-proposal.ts';
import type {DecisionInput} from '../packages/shared/src/index.ts';
import type {LiveTurn} from '../packages/providers/src/adapter.ts';
export const HYBRID_VERSION='shared-restock-hybrid-1';
export const HYBRID_POLICIES=['rules','jev','zoom','zoom-pro'] as const;
type Model=Exclude<typeof HYBRID_POLICIES[number],'rules'>;
type Action=DecisionInput['legalActions'][number];
export function hybridExecution(input:DecisionInput,turn:LiveTurn){
 const selected=turn.result.status==='success'?turn.result.action:null;
 const original=turn.result.status==='fallback'?turn.result.appliedAction:selected;
 if(!original||!input.legalActions.includes(original))throw new Error('Invalid controller action');
 const eligible=turn.result.status==='success'&&(turn.origin==='provider'||turn.origin==='recovered');
 const intervention=eligible?proposeRestockRecovery(input,original):null;
 return {modelSelectedAction:eligible?selected:null,executedAction:intervention?.proposedAction??original,source:intervention?'shared-restock-recovery':turn.origin,intervention};
}
export async function runHybridComparison(options:{roundId:string;seed:number;controllers:Record<Model,(input:DecisionInput)=>Promise<LiveTurn>>;checkpoint?:(record:unknown)=>Promise<void>}){
 const schedule=createDemandSchedule(options.seed,'clean');
 const positions=Object.fromEntries(HYBRID_POLICIES.map(p=>[p,{frame:createInitialFrame(),history:[] as {tick:number;action:Action}[]}])) as Record<typeof HYBRID_POLICIES[number],{frame:ReturnType<typeof createInitialFrame>;history:{tick:number;action:Action}[]}>;
 const decisions:({policy:typeof HYBRID_POLICIES[number];tick:number;input:DecisionInput;turn:LiveTurn|null}&ReturnType<typeof hybridExecution>)[]=[];
 for(let tick=0;tick<120;tick++){
  for(const policy of HYBRID_POLICIES){
   const position=positions[policy];let frame=position.frame;if(frame.stage==='committed')frame=advanceTick(frame);
   const promo=frame.state.promotion,event=eventAt(schedule,tick),arrivals=arrivalsAt(schedule,tick,!!promo&&promo.startsAt<=tick&&promo.endsAt>=tick).map(toEngineArrival);
   frame=prepareTick(frame,event?{arrivals,event}:{arrivals});
   const input=decisionInput(frame.state,options.roundId,position.history.slice(-5));
   const turn=policy==='rules'?null:await options.controllers[policy](input);
   const execution=turn?hybridExecution(input,turn):{modelSelectedAction:null,executedAction:chooseRules(input.observation,input.legalActions).action,source:'rules',intervention:null};
   decisions.push({policy,tick,input,...execution,turn});
   position.frame=applyAction(frame,execution.executedAction);position.history.push({tick,action:execution.executedAction});
  }
  await options.checkpoint?.({version:HYBRID_VERSION,roundId:options.roundId,seed:options.seed,tick,positions,decisions});
 }
 const results=HYBRID_POLICIES.map(policy=>{const final=settle(advanceTick(positions[policy].frame));return {policy,label:policy==='rules'?'Rules (frozen)':`${policy} + shared restock recovery`,score:scoreState(final.state),totals:final.state.totals,closingCashCents:final.state.cashCents,closingRawPortions:final.state.rawPortions,interventions:decisions.filter(d=>d.policy===policy&&d.intervention).map(d=>d.tick)};});
 return {status:'completed',version:HYBRID_VERSION,roundId:options.roundId,seed:options.seed,decisions,results};
}
