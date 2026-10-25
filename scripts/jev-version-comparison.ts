import {createInitialFrame,prepareTick,applyAction,advanceTick,settle} from '../packages/simulation/src/engine.ts';
import {createDemandSchedule,arrivalsAt,toEngineArrival,eventAt} from '../packages/simulation/src/demand.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
import {scoreState} from '../packages/simulation/src/scoring.ts';
import type {DecisionInput} from '../packages/shared/src/index.ts';
import type {LiveTurn} from '../packages/providers/src/adapter.ts';
export const JEV_VERSION_EXPERIMENT='jev-version-raw-1';
/** One model only. Every executed action is its unmodified successful choice. */
export async function runJevVersionComparison(options:{roundId:string;seed:number;model:string;decide:(input:DecisionInput)=>Promise<LiveTurn>;checkpoint?:(record:unknown)=>Promise<void>}){
 const schedule=createDemandSchedule(options.seed,'clean');let frame=createInitialFrame();
 const history:{tick:number;action:DecisionInput['legalActions'][number]}[]=[],decisions=[];
 for(let tick=0;tick<120;tick++){
  if(frame.stage==='committed')frame=advanceTick(frame);
  const promo=frame.state.promotion,event=eventAt(schedule,tick),arrivals=arrivalsAt(schedule,tick,!!promo&&promo.startsAt<=tick&&promo.endsAt>=tick).map(toEngineArrival);
  frame=prepareTick(frame,event?{arrivals,event}:{arrivals});
  const input=decisionInput(frame.state,options.roundId,history.slice(-5)),turn=await options.decide(input);
  if(turn.result.status!=='success')throw new Error(`Provider failure at tick ${tick}: ${turn.result.fallbackReason}`);
  const forced=input.legalActions.length===1;
  if(forced?turn.origin!=='forced_wait':turn.origin!=='provider'||turn.result.modelVersion!==options.model)throw new Error('Unexpected model/origin');
  const action=turn.result.action;
  if(!action||!input.legalActions.includes(action))throw new Error('Illegal action');
  decisions.push({tick,input,turn,executedAction:action,source:turn.origin});
  frame=applyAction(frame,action);history.push({tick,action});
  await options.checkpoint?.({status:'in-progress',version:JEV_VERSION_EXPERIMENT,roundId:options.roundId,seed:options.seed,model:options.model,tick,decisions});
 }
 const final=settle(advanceTick(frame));
 return {status:'completed',version:JEV_VERSION_EXPERIMENT,roundId:options.roundId,seed:options.seed,model:options.model,guardEnabled:false,decisions,score:scoreState(final.state),totals:final.state.totals,closingCashCents:final.state.cashCents,closingRawPortions:final.state.rawPortions};
}
