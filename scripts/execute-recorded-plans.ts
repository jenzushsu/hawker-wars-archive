import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createInitialFrame,prepareTick,applyAction,advanceTick,settle} from '../packages/simulation/src/engine.ts';
import {createDemandSchedule,arrivalsAt,toEngineArrival,eventAt} from '../packages/simulation/src/demand.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
import {scoreState} from '../packages/simulation/src/scoring.ts';
import {chooseRules,type Action} from '../packages/decisions/src/rules.ts';
import {createShortPlanExecutor,type ShortPlan} from '../packages/decisions/src/short-plan.ts';

type RecordedAction={policy:string;tick:number;action:Action};
export function executeRecordedPlan(rows:RecordedAction[],startTick:number,mode:ShortPlan|'recorded'|'rules') {
  const recorded=rows.filter(r=>r.policy==='jev').sort((a,b)=>a.tick-b.tick);
  if(recorded.length!==120||recorded.some((r,i)=>r.tick!==i))throw new Error('Incomplete prefix evidence');
  const schedule=createDemandSchedule(7,'clean');
  let frame=createInitialFrame();
  const plan=mode==='RESTOCK'||mode==='WAIT'?createShortPlanExecutor(startTick,mode):null;
  const history:{tick:number;action:Action}[]=[];
  const trace=[];
  let startObservation:ReturnType<typeof decisionInput>['observation']|undefined;
  for(let tick=0;tick<120;tick++) {
    if(frame.stage==='committed')frame=advanceTick(frame);
    const p=frame.state.promotion;
    const arrivals=arrivalsAt(schedule,tick,!!p&&p.startsAt<=tick&&p.endsAt>=tick).map(toEngineArrival),event=eventAt(schedule,tick);
    frame=prepareTick(frame,event?{arrivals,event}:{arrivals});
    const input=decisionInput(frame.state,'32b5d1e3-f6a2-4e0b-a5c0-38cec0c3a863',history.slice(-5));
    if(tick===startTick)startObservation=input.observation;
    const action=tick<startTick||mode==='recorded'?recorded[tick]!.action:mode==='rules'?chooseRules(input.observation,input.legalActions).action:plan!.decide(input.observation);
    if(!input.legalActions.includes(action))throw new Error('Execution produced illegal action');
    if(tick>=startTick)trace.push({tick,action,legalActions:input.legalActions,raw:frame.state.rawPortions,ready:frame.state.readyBatches.reduce((n,b)=>n+b.quantity,0),cooking:frame.state.cooking,pendingRestock:frame.state.pendingRestock,queue:frame.state.queue.length});
    history.push({tick,action});frame=applyAction(frame,action);
  }
  frame=settle(advanceTick(frame));
  return {startTick,mode,startObservation,score:scoreState(frame.state),totals:frame.state.totals,
    closingRaw:frame.state.rawPortions,
    continuation:{restockTicks:trace.filter(t=>t.action==='RESTOCK').map(t=>t.tick),cookTicks:trace.filter(t=>t.action==='COOK').map(t=>t.tick),serveTicks:trace.filter(t=>t.action==='SERVE').map(t=>t.tick),emptyPipelineWaitTicks:trace.filter(t=>t.action==='WAIT'&&!t.raw&&!t.ready&&!t.cooking&&!t.pendingRestock).map(t=>t.tick)},trace};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const base='docs/deployment/evidence/prompt-v2/';
  const rows=JSON.parse(readFileSync(base+'v2-decisions.json','utf8')) as RecordedAction[];
  const captured=JSON.parse(readFileSync(base+'jev-investigation.json','utf8')).capturedStates;
  const outcomes=[57,109].flatMap(tick=>(['recorded','RESTOCK','WAIT','rules'] as const).map(mode=>executeRecordedPlan(rows,tick,mode)));
  for(const outcome of outcomes) {
    const expected=captured.find((s:{tick:number})=>s.tick===outcome.startTick);
    if(JSON.stringify(outcome.startObservation)!==JSON.stringify(expected.observation))throw new Error('Captured state mismatch');
    if(outcome.mode==='recorded'&&(outcome.score.profitCents!==10600||outcome.score.utilityPoints!==870||outcome.totals.served!==46))throw new Error('Baseline replay mismatch');
  }
  const samples=JSON.parse(readFileSync(base+'repeatability-experiment.json','utf8')).results;
  const modelExecutions=samples.map((sample:any)=>{
    const result=sample.outcome.result;
    if(result.status!=='success'||!['RESTOCK','WAIT'].includes(result.action))throw new Error('No successful recorded plan');
    const executed=executeRecordedPlan(rows,sample.tick,result.action);
    return {provider:sample.provider,replicate:sample.replicate,order:sample.variant,requestId:result.requestId,startTick:sample.tick,selectedPlan:result.action,score:executed.score,served:executed.totals.served,abandoned:executed.totals.abandoned};
  });
  const report={scope:'Offline execution of previously selected one-order plans on the captured Jev trajectory, clean seed 7. No new inference or live deployment.',providerCalls:0,outcomes,modelExecutions};
  writeFileSync(base+'executed-plans.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(outcomes.map(o=>({tick:o.startTick,mode:o.mode,score:o.score,served:o.totals.served,abandoned:o.totals.abandoned,continuation:o.continuation})),null,2));
}
