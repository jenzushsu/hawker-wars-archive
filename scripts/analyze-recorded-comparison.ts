import {readFileSync,writeFileSync} from 'node:fs';
import {createInitialFrame,prepareTick,applyAction,advanceTick,settle} from '../packages/simulation/src/engine.ts';
import {createDemandSchedule,arrivalsAt,toEngineArrival,eventAt} from '../packages/simulation/src/demand.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
import {chooseRules} from '../packages/decisions/src/rules.ts';
import {scoreState} from '../packages/simulation/src/scoring.ts';
const rows=JSON.parse(readFileSync(process.argv[2]!,'utf8')),report=[];
const seed=Number(process.argv[4]??7);
if(!Number.isInteger(seed)||seed<0||seed>99)throw new Error('Invalid seed');
for(const policy of ['rules','jev','zoom','zoom-pro']){
 const choices=rows.filter((r:any)=>r.policy===policy).sort((a:any,b:any)=>a.tick-b.tick);
 if(choices.length!==120||choices.some((r:any,i:number)=>r.tick!==i))throw new Error('Expected complete decision history');
 const schedule=createDemandSchedule(seed,'clean');let frame=createInitialFrame();
 const stats:any={policy,actionCounts:{},fallbacks:[],voluntaryWaits:0,forcedWaits:0,emptyStockWaitsWithRestockAvailable:[],waitsWithServeAvailable:[],waitsWithCookAvailable:[],waitsWithReadyStock:[],cookTicks:[],restockTicks:[],lastServeTick:null};
 for(let tick=0;tick<120;tick++){
  if(frame.stage==='committed')frame=advanceTick(frame);
  const promo=frame.state.promotion,arrivals=arrivalsAt(schedule,tick,!!promo&&promo.startsAt<=tick&&promo.endsAt>=tick).map(toEngineArrival),event=eventAt(schedule,tick);
  frame=prepareTick(frame,event?{arrivals,event}:{arrivals});
  const input=decisionInput(frame.state,'11111111-1111-4111-8111-111111111111',choices.slice(Math.max(0,tick-5),tick).map((r:any)=>({tick:r.tick,action:r.action})));
  const r=choices[tick],ready=frame.state.readyBatches.reduce((n,b)=>n+b.quantity,0);
  if(!input.legalActions.includes(r.action))throw new Error('Recorded illegal action');
  if(policy==='rules'&&chooseRules(input.observation,input.legalActions).action!==r.action)throw new Error('Frozen rules policy mismatch');
  stats.actionCounts[r.action]=(stats.actionCounts[r.action]??0)+1;
  if(r.fallback)stats.fallbacks.push({tick,reason:r.fallback});
  if(r.action==='WAIT'){
   if(input.legalActions.length===1)stats.forcedWaits++;else stats.voluntaryWaits++;
   if(!frame.state.rawPortions&&!ready&&!frame.state.cooking&&input.legalActions.includes('RESTOCK'))stats.emptyStockWaitsWithRestockAvailable.push(tick);
   if(input.legalActions.includes('SERVE'))stats.waitsWithServeAvailable.push(tick);
   if(input.legalActions.includes('COOK'))stats.waitsWithCookAvailable.push(tick);
   if(ready)stats.waitsWithReadyStock.push({tick,ready,queue:frame.state.queue.length});
  }
  if(r.action==='COOK')stats.cookTicks.push(tick);
  if(r.action==='RESTOCK')stats.restockTicks.push(tick);
  if(r.action==='SERVE')stats.lastServeTick=tick;
  frame=applyAction(frame,r.action);
 }
 frame=settle(advanceTick(frame));stats.score=scoreState(frame.state);stats.totals=frame.state.totals;stats.closingCashCents=frame.state.cashCents;stats.closingRawPortions=frame.state.rawPortions;stats.seed=seed;report.push(stats);
}
writeFileSync(process.argv[3]!,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.map(s=>({policy:s.policy,profit:s.score.profitCents,utility:s.score.utilityPoints,emptyStockWaits:s.emptyStockWaitsWithRestockAvailable.length}))));
