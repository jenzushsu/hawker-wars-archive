import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {DecisionInputSchema,type DecisionInput} from '../packages/shared/src/index.ts';
import {getLegalActions} from '../packages/simulation/src/legality.ts';
import {proposeRestockRecovery} from '../packages/decisions/src/restock-recovery-proposal.ts';
const source=()=>JSON.parse(readFileSync('manifests/tick63-input.json','utf8')) as DecisionInput;
function at(tick:number,delay=false){
 const x=source(),o=x.observation;x.tick=o.tick=tick;o.remainingMinutes=120-tick;o.demandPhase=tick<90?'peak':'off-peak';
 o.queue=o.queue.map((c,i)=>({...c,id:`customer-${tick}-base-${i}`,arrivalTick:tick,deadlineTick:tick+c.patience}));
 o.recentActions=[];o.effects=delay?[{type:'supplier-delay',startsAt:tick,endsAt:tick+9}]:[];
 x.legalActions=o.legalActions=getLegalActions(o);return DecisionInputSchema.parse(x);
}
describe('offline restock recovery proposal',()=>{
 it('proposes recovery on the exact stockout without changing the input',()=>{
  const x=source(),before=JSON.stringify(x);
  expect(proposeRestockRecovery(x,'WAIT')).toMatchObject({proposedAction:'RESTOCK',deliveryTick:73,earliestReadyTick:78,serviceTicks:42});expect(JSON.stringify(x)).toBe(before);
 });
 it.each([[95,false,true],[96,false,false],[90,true,true],[91,true,false],[109,false,false],[110,false,false]] as const)('respects the service margin at tick %i, supplier delay %s',(tick,delay,eligible)=>{
  expect(proposeRestockRecovery(at(tick,delay),'WAIT')!==null).toBe(eligible);
 });
 it('does not replace non-WAIT choices',()=>{expect(proposeRestockRecovery(source(),'RESTOCK')).toBeNull();});
 it('leaves existing cooking alone',()=>{
  const inputs=JSON.parse(readFileSync('manifests/pipeline-validation-inputs.json','utf8'));
  expect(proposeRestockRecovery(inputs.find((x:any)=>x.tick===58),'WAIT')).toBeNull();
 });
 it('does not override available stock or pending deliveries',()=>{
  const original=source();
  for(const kind of ['raw','ready','pending'] as const){
   const x=structuredClone(original),o=x.observation;
   if(kind==='raw'){o.rawPortions=10;o.totals.wasted-=10;}
   if(kind==='ready'){o.readyBatches=[{id:'batch-60',quantity:10,expiresAt:80}];o.totals.wasted-=10;}
   if(kind==='pending'){o.pendingRestock={quantity:20,dueTick:73,delayApplied:false};o.totals.restockOrders++;o.totals.purchasedPortions+=20;o.cashCents-=4000;o.cumulativePurchasesCents+=4000;}
   x.legalActions=o.legalActions=getLegalActions(o);expect(proposeRestockRecovery(x,'WAIT')).toBeNull();
  }
 });
 it('fails closed when cash or the captured legal choices prohibit restocking',()=>{
  const x=source(),o=x.observation;o.totals.promotions=69;o.cashCents-=34500;o.cumulativePromotionSpendCents=34500;x.legalActions=o.legalActions=getLegalActions(o);
  expect(proposeRestockRecovery(x,'WAIT')).toBeNull();
  const omitted=source();omitted.legalActions=omitted.observation.legalActions=['WAIT'];expect(proposeRestockRecovery(omitted,'WAIT')).toBeNull();
 });
});
