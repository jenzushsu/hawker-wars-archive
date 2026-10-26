import {readFileSync,writeFileSync} from 'node:fs';
import {createInitialFrame,prepareTick,applyAction,advanceTick,settle} from '../packages/simulation/src/engine.ts';
import {createDemandSchedule,arrivalsAt,toEngineArrival,eventAt} from '../packages/simulation/src/demand.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
import {chooseRules} from '../packages/decisions/src/rules.ts';
import {scoreState} from '../packages/simulation/src/scoring.ts';
import type {DecisionInput} from '../packages/shared/src/index.ts';
const directory='docs/deployment/evidence/v4-full';
const rows=JSON.parse(readFileSync(directory+'/decisions.json','utf8')) as {policy:string;tick:number;action:DecisionInput['legalActions'][number]}[];
function replay(policy:string,rescueTick?:number){
 const choices=rows.filter(r=>r.policy===policy).sort((a,b)=>a.tick-b.tick),schedule=createDemandSchedule(23,'clean');let frame=createInitialFrame();
 const history:{tick:number;action:DecisionInput['legalActions'][number]}[]=[],ticks=[];
 for(let tick=0;tick<120;tick++){
  if(frame.stage==='committed')frame=advanceTick(frame);
  const promo=frame.state.promotion,event=eventAt(schedule,tick),arrivals=arrivalsAt(schedule,tick,!!promo&&promo.startsAt<=tick&&promo.endsAt>=tick).map(toEngineArrival);
  frame=prepareTick(frame,event?{arrivals,event}:{arrivals});
  const input=decisionInput(frame.state,'11111111-1111-4111-8111-111111111111',history.slice(-5)),o=input.observation;
  const action=rescueTick!==undefined&&tick>=rescueTick?chooseRules(o,input.legalActions).action:choices[tick]!.action;
  if(!input.legalActions.includes(action))throw new Error('Illegal replay action');
  const ready=o.readyBatches.reduce((n,b)=>n+b.quantity,0);
  ticks.push({tick,action,legal:input.legalActions,cashCents:o.cashCents,raw:o.rawPortions,ready,cooking:o.cooking,pending:o.pendingRestock,queue:o.queue.length,headDeadline:o.queue[0]?.deadlineTick??null,arrivals:arrivals.length,served:o.totals.served,abandoned:o.totals.abandoned,wasted:o.totals.wasted,
   emptyPipeline:!o.rawPortions&&!ready&&!o.cooking&&!o.pendingRestock});
  frame=applyAction(frame,action);history.push({tick,action});
 }
 frame=settle(advanceTick(frame));
 const waits=ticks.filter(t=>t.action==='WAIT');
 return {policy,rescueTick:rescueTick??null,score:scoreState(frame.state),totals:frame.state.totals,rawAtClosing:frame.state.rawPortions,ticks,
  waits:{total:waits.length,forced:waits.filter(t=>t.legal.length===1).map(t=>t.tick),emptyPipelineRestockLegal:waits.filter(t=>t.emptyPipeline&&t.legal.includes('RESTOCK')).map(t=>t.tick),serveLegal:waits.filter(t=>t.legal.includes('SERVE')).map(t=>t.tick),cookLegal:waits.filter(t=>t.legal.includes('COOK')).map(t=>t.tick),readyStock:waits.filter(t=>t.ready>0).map(t=>({tick:t.tick,ready:t.ready,queue:t.queue})),inFlight:waits.filter(t=>t.cooking||t.pending).map(t=>t.tick)}};
}
const actual=['jev','zoom'].map(p=>replay(p));
const expected=JSON.parse(readFileSync(directory+'/analysis.json','utf8'));
for(const a of actual){const e=expected.find((e:any)=>e.policy===a.policy);if(JSON.stringify(a.score)!==JSON.stringify(e.score)||JSON.stringify(a.totals)!==JSON.stringify(e.totals))throw new Error('Replay differs from verified results');}
const counterfactual=replay('jev',63);
const report={scope:'Offline reconstruction only; no provider calls. Zoom Standard and Jev followed different state trajectories. Counterfactual switches to frozen Rules at tick 63; it does not predict a Jev response.',actual,counterfactual};
writeFileSync(directory+'/idle-analysis.json',JSON.stringify(report,null,2)+'\n');
for(const a of actual){console.log(JSON.stringify({policy:a.policy,score:a.score,totals:a.totals,rawAtClosing:a.rawAtClosing,waits:a.waits,timeline:a.ticks.filter(t=>[19,43,53,58,59,60,61,62,63,64,73,78,80,90,99,109,110,114,119].includes(t.tick))}));}
console.log(JSON.stringify({counterfactual:'Switch Jev to Rules at tick 63',score:counterfactual.score,totals:counterfactual.totals,restocks:counterfactual.ticks.filter(t=>t.action==='RESTOCK').map(t=>t.tick)}));
