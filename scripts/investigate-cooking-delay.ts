import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createInitialFrame,prepareTick,applyAction,advanceTick,settle} from '../packages/simulation/src/engine.ts';
import {createDemandSchedule,arrivalsAt,toEngineArrival,eventAt} from '../packages/simulation/src/demand.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
import {scoreState} from '../packages/simulation/src/scoring.ts';
import {chooseRules} from '../packages/decisions/src/rules.ts';
import {buildActionCriteriaRequest,actionCriteriaInstructions} from '../packages/providers/src/action-criteria-experiment.ts';
import type {DecisionInput} from '../packages/shared/src/index.ts';
const dir='docs/deployment/evidence/criteria-comparison',r=JSON.parse(readFileSync(dir+'/result.json','utf8'));
const assert=(ok:boolean,m:string)=>{if(!ok)throw new Error(m);};
function replay(cookAt?:number){
 const schedule=createDemandSchedule(23,'clean');let frame=createInitialFrame();const history:{tick:number;action:DecisionInput['legalActions'][number]}[]=[],timeline=[];let checkpoint:any;
 for(let tick=0;tick<120;tick++){
  if(frame.stage==='committed')frame=advanceTick(frame);
  const promo=frame.state.promotion,event=eventAt(schedule,tick),arrivals=arrivalsAt(schedule,tick,!!promo&&promo.startsAt<=tick&&promo.endsAt>=tick).map(toEngineArrival);
  frame=prepareTick(frame,event?{arrivals,event}:{arrivals});const input=decisionInput(frame.state,r.roundId,history.slice(-5));
  if(cookAt===undefined||tick<=86)assert(JSON.stringify(input)===JSON.stringify(r.decisions[tick].input),'Prefix mismatch');
  const action:DecisionInput['legalActions'][number]=cookAt===undefined||tick<86?r.decisions[tick].executedAction:tick===cookAt?'COOK':tick<=94?(input.legalActions.includes('SERVE')?'SERVE':'WAIT'):chooseRules(input.observation,input.legalActions).action;
  assert(input.legalActions.includes(action),'Illegal counterfactual');
  const before=frame.state.totals.served,ids=frame.state.queue.map(c=>c.id);frame=applyAction(frame,action);
  if(tick>=86&&tick<=94)timeline.push({tick,action,raw:input.observation.rawPortions,ready:input.observation.readyBatches.reduce((n,b)=>n+b.quantity,0),queue:input.observation.queue.map(c=>({id:c.id,deadline:c.deadlineTick})),servedIds:ids.slice(0,frame.state.totals.served-before),totals:frame.state.totals});
  if(tick===94)checkpoint={totals:frame.state.totals,cashCents:frame.state.cashCents,raw:frame.state.rawPortions};
  history.push({tick,action});
 }
 const final=settle(advanceTick(frame));return {cookAt:cookAt??null,timeline,checkpoint94:checkpoint,score:scoreState(final.state),totals:final.state.totals};
}
const actual=replay();assert(JSON.stringify(actual.score)===JSON.stringify(r.score)&&JSON.stringify(actual.totals)===JSON.stringify(r.totals),'Actual replay mismatch');
const states=[86,87,88].map(tick=>{
 const d=r.decisions[tick],body=JSON.stringify(buildActionCriteriaRequest('jev',d.input,r.model).body);
 assert(createHash('sha256').update(body).digest('hex')===r.requestEvidence.find((e:any)=>e.tick===tick).bodyHash,'Prompt mismatch');
 const o=d.input.observation;return {tick,raw:o.rawPortions,ready:o.readyBatches,queue:o.queue,cooking:o.cooking,pending:o.pendingRestock,legal:d.input.legalActions,choice:d.executedAction,probabilities:d.turn.result.probabilities,instructions:actionCriteriaInstructions(d.input),cookNowReadyAt:tick+5,originalQueueSurvivingCookNow:o.queue.filter((c:any)=>c.deadlineTick>tick+5).map((c:any)=>c.id)};
});
const counterfactuals=[86,87,88].map(replay);
const report={scope:'Offline only, no provider calls. Actual trajectory exactly replayed. Counterfactuals use recorded prefix through85, start one batch at86/87/88, SERVE whenever legal otherwise WAIT through94, then the same frozen Rules controller from95. They are not predictions of Jev after intervention or an optimality proof.',states,actual,counterfactuals};
writeFileSync(dir+'/cooking-delay.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({states:states.map(({instructions,queue,ready,probabilities,...s})=>({...s,queueCount:queue.length,probabilities})),actual:{score:actual.score,checkpoint:actual.checkpoint94},counterfactuals:counterfactuals.map(c=>({cookAt:c.cookAt,checkpoint:c.checkpoint94,score:c.score,totals:c.totals}))},null,2));
