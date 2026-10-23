import type { SimulatorState } from '../../shared/src/index.js';
export interface Resolution { customerId:string; arrivalTick:number; tick:number; waitMinutes:number; outcome:'served'|'queue_full'|'patience_expired'|'closing_unserved' }
function validateResolutions(state:SimulatorState,resolutions:readonly Resolution[]):void {
  const outcomes=['served','queue_full','patience_expired','closing_unserved'];
  for(const r of resolutions){
    if(!r||typeof r.customerId!=='string'||r.customerId.length===0||!outcomes.includes(r.outcome)||
      !Number.isSafeInteger(r.arrivalTick)||r.arrivalTick<0||r.arrivalTick>=120||
      !Number.isSafeInteger(r.tick)||r.tick<r.arrivalTick||r.tick>state.tick||
      !Number.isSafeInteger(r.waitMinutes)||Object.is(r.waitMinutes,-0)||r.waitMinutes<0||r.waitMinutes!==r.tick-r.arrivalTick||
      (r.outcome==='queue_full'&&r.waitMinutes!==0)||(r.outcome==='closing_unserved'&&r.tick!==120))throw new Error('Invalid customer resolution');
  }
  const served=resolutions.filter(r=>r.outcome==='served');
  if(resolutions.length!==state.totals.served+state.totals.abandoned||served.length!==state.totals.served||resolutions.reduce((n,r)=>n+r.waitMinutes,0)!==state.totals.waitMinutes||new Set(resolutions.map(r=>r.customerId)).size!==resolutions.length)throw new Error('Resolution projection differs from authoritative counters');
}
export function scoreState(state:SimulatorState,resolutions?:readonly Resolution[]) {
  if(resolutions)validateResolutions(state,resolutions);
  const ready=state.readyBatches.reduce((n,b)=>n+b.quantity,0);
  const profitCents=state.phase==='closed'?state.cashCents+200*state.rawPortions-28400:state.cashCents+200*(state.rawPortions+ready+(state.cooking?.quantity??0)+(state.pendingRestock?.quantity??0))-28400;
  const count=state.totals.served+state.totals.abandoned;
  const satisfaction=resolutions?.length ? resolutions.reduce((sum,r)=>sum+(r.outcome==='served'?Math.max(0,100-10*r.waitMinutes):0),0)/resolutions.length : count===0?null:state.totals.served===0?0:null;
  return {profitCents,utilityPoints:profitCents-100*state.totals.abandoned-5*state.totals.waitMinutes-50*state.totals.wasted,meanWaitMinutes:count?state.totals.waitMinutes/count:null,satisfaction,provisional:state.phase!=='closed'};
}
export function episodeMetrics(state:SimulatorState,resolutions:readonly Resolution[],stockoutTicks:number) {
  validateResolutions(state,resolutions);
  if(!Number.isSafeInteger(stockoutTicks)||Object.is(stockoutTicks,-0)||stockoutTicks<0||stockoutTicks>120)throw new Error('Invalid stockout count');
  const served=resolutions.filter(r=>r.outcome==='served');
  const totalWait=resolutions.reduce((n,r)=>n+r.waitMinutes,0);
  if(totalWait!==state.totals.waitMinutes||served.length!==state.totals.served||new Set(resolutions.map(r=>r.customerId)).size!==resolutions.length)throw new Error('Resolution projection differs from authoritative counters');
  return {...scoreState(state,resolutions),served:state.totals.served,abandoned:state.totals.abandoned,wasted:state.totals.wasted,waitMinutes:totalWait,servedMeanWaitMinutes:served.length?served.reduce((n,r)=>n+r.waitMinutes,0)/served.length:null,fillRate:state.totals.arrivals?state.totals.served/state.totals.arrivals:null,stockoutTicks};
}
export function rankResults<T extends {policy:string;profitCents:number;latencyMs?:number}>(results:readonly T[],metric:'profitCents'='profitCents'):{policy:string;rank:number}[] {
  if(results.some(r=>!Number.isSafeInteger(r[metric]))||new Set(results.map(r=>r.policy)).size!==results.length)throw new Error('Invalid ranking inputs');
  return results.map(r=>({policy:r.policy,rank:1+results.filter(other=>other[metric]>r[metric]).length}));
}
