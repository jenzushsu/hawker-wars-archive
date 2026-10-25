import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {DecisionInputSchema,type DecisionInput} from '../packages/shared/src/index.ts';
import {buildRequest,canonicalDecisionContext} from '../packages/providers/src/wire.ts';
import {createInitialFrame,prepareTick,applyAction,advanceTick} from '../packages/simulation/src/engine.ts';
import {createDemandSchedule,arrivalsAt,toEngineArrival,eventAt} from '../packages/simulation/src/demand.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
const providers=['jev','zoom','zoom-pro'] as const;
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
function check(input:DecisionInput){
 const requests=providers.map(p=>buildRequest(p,input,'jev-1.13.0'));
 for(const r of requests)expect(Buffer.byteLength(JSON.stringify(r.body))).toBeLessThanOrEqual(8192);
 expect(requests[0]!.body.state).toBe(requests[1]!.body.input);
 expect(requests[1]!.body.input).toBe(requests[2]!.body.input);
 const instructions=(requests[0]!.body.questions as {action:{instructions:string}}).action.instructions;
 for(const r of requests.slice(1))expect((r.body.questions as {instructions:string}[])[0]!.instructions).toBe(instructions);
 const context=JSON.parse(canonicalDecisionContext(input));
 const legacy=JSON.parse(canonicalDecisionContext(input,'hawker-decision-prompt-3'));
 const {demandDefaults:_,...rules}=legacy.publicRules;
 expect(context.publicRules).toEqual(rules);
 expect(context.objective).toEqual(legacy.objective);
 const restored={...context.observation,legalActions:context.legalActions};
 for(const key of ['queue','readyBatches','recentActions']){
  const table=restored[key];restored[key]=table.rows.map((row:unknown[])=>Object.fromEntries(table.columns.map((column:string,i:number)=>[column,row[i]])));
 }
 expect(restored).toEqual(input.observation);
}
describe('provider request envelope',()=>{
 it.each([7,11,23])('fits every recorded policy trajectory on seed %i without losing observation data',seed=>{
  const rows=read(`docs/deployment/evidence/fair-120-tick/seed-${seed}-decisions.json`) as {policy:string;tick:number;action:DecisionInput['legalActions'][number]}[];
  for(const policy of ['rules',...providers]){
   const choices=rows.filter(r=>r.policy===policy).sort((a,b)=>a.tick-b.tick);
   const schedule=createDemandSchedule(seed,'clean');let frame=createInitialFrame();
   for(let tick=0;tick<120;tick++){
    if(frame.stage==='committed')frame=advanceTick(frame);
    const promo=frame.state.promotion,event=eventAt(schedule,tick);
    const arrivals=arrivalsAt(schedule,tick,!!promo&&promo.startsAt<=tick&&promo.endsAt>=tick).map(toEngineArrival);
    frame=prepareTick(frame,event?{arrivals,event}:{arrivals});
    const input=decisionInput(frame.state,'11111111-1111-4111-8111-111111111111',choices.slice(Math.max(0,tick-5),tick));
    if(input.legalActions.length>1)check(input);
    if(seed===23&&tick===80&&(policy==='zoom'||policy==='zoom-pro')){
     const old=buildRequest(policy,input,undefined,'hawker-decision-prompt-3');
     expect(Buffer.byteLength(JSON.stringify(old.body))).toBe(policy==='zoom'?8216:8207);
    }
    frame=applyAction(frame,choices[tick]!.action);
   }
  }
 },30000);
 it.each([false,true])('fits a conservative capacity envelope with cooking/promotion=%s',inFlight=>{
  const o=read('fixtures/observation-2-initial.json') as DecisionInput['observation'];
  Object.assign(o,{tick:109,remainingMinutes:11,rawPortions:40,cashCents:56000,
   readyBatches:Array.from({length:inFlight?20:30},(_,i)=>({id:`batch-${100+i}`,quantity:1,expiresAt:139})),
   queue:Array.from({length:30},(_,i)=>({id:`customer-109-promotion-${i}`,arrivalTick:109,patience:10,deadlineTick:119})),
   pendingRestock:{quantity:20,dueTick:119,delayApplied:true},
   cooking:inFlight?{quantity:10,dueTick:119}:null,
   promotion:inFlight?{startsAt:110,endsAt:119}:null,
   effects:[{type:'supplier-delay',startsAt:109,endsAt:118}],
   recentActions:Array.from({length:5},(_,i)=>({tick:104+i,action:'RESTOCK'})),
   totals:{served:352,abandoned:999,wasted:0,waitMinutes:9999,arrivals:1381,purchasedPortions:400,restockOrders:20,promotions:120},
   cumulativeRevenueCents:176000,cumulativePurchasesCents:80000,cumulativePromotionSpendCents:60000,
   legalActions:['SERVE','COOK','RESTOCK','PROMOTE','WAIT']});
  // Deliberately includes incompatible actions/capacity maxima to overestimate a real request.
  check(DecisionInputSchema.parse({roundId:'11111111-1111-4111-8111-111111111111',tick:109,observation:o,legalActions:o.legalActions}));
 });
});
