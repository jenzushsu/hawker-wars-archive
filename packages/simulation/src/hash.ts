import { createHash } from 'node:crypto';
import type { EngineFrame } from './types.js';
import type { Observation } from '../../shared/src/index.js';
import { HashSchema } from '../../shared/src/index.js';
import { assertFrame } from './engine.js';
import type { DemandScenario } from './demand.js';

export function canonicalState(value: unknown): string {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isSafeInteger(value)&&!Object.is(value,-0))return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalState).join(',')}]`;
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){const r=value as Record<string,unknown>;return `{${Object.keys(r).sort().map(k=>`${JSON.stringify(k)}:${canonicalState(r[k])}`).join(',')}}`;}
  throw new Error('State hashing requires canonical integer-only JSON data');
}
export interface StateHashInput { frame:EngineFrame;scheduleHash:string;scenario:DemandScenario;configurationHash:string;recentActions:Observation['recentActions'] }
export function stateHash(input:StateHashInput):string {
  const {frame}=input;assertFrame(frame);HashSchema.parse(input.configurationHash);HashSchema.parse(input.scheduleHash);
  // Copy known state fields; operational/additional metadata cannot affect identity.
  const s=frame.state;
  const state={tick:s.tick,phase:s.phase,cashCents:s.cashCents,rawPortions:s.rawPortions,
    readyBatches:s.readyBatches.map(b=>({id:b.id,quantity:b.quantity,expiresAt:b.expiresAt})),
    cooking:s.cooking?{quantity:s.cooking.quantity,dueTick:s.cooking.dueTick}:null,
    pendingRestock:s.pendingRestock?{quantity:s.pendingRestock.quantity,dueTick:s.pendingRestock.dueTick,delayApplied:s.pendingRestock.delayApplied}:null,
    promotion:s.promotion?{startsAt:s.promotion.startsAt,endsAt:s.promotion.endsAt}:null,promotionEligibleAt:s.promotionEligibleAt,
    queue:s.queue.map(c=>({id:c.id,arrivalTick:c.arrivalTick,patience:c.patience,deadlineTick:c.deadlineTick})),
    effects:s.effects.map(e=>({type:e.type,startsAt:e.startsAt,endsAt:e.endsAt})),
    totals:{served:s.totals.served,abandoned:s.totals.abandoned,wasted:s.totals.wasted,waitMinutes:s.totals.waitMinutes,arrivals:s.totals.arrivals,purchasedPortions:s.totals.purchasedPortions,restockOrders:s.totals.restockOrders,promotions:s.totals.promotions},
  };
  const envelope={schemaVersion:'state-hash-1',configurationHash:input.configurationHash,scheduleHash:input.scheduleHash,scenario:input.scenario,
    stage:frame.stage,boundaryTick:frame.boundaryTick,state,
    ledger:{openingCashCents:frame.ledger.openingCashCents,openingPortions:frame.ledger.openingPortions},
    appliedEvents:[...frame.appliedEvents].sort((a,b)=>a.effectiveTick-b.effectiveTick||(a.id<b.id?-1:a.id>b.id?1:0)).map(e=>({id:e.id,type:e.type,effectiveTick:e.effectiveTick,endsAt:e.endsAt??e.effectiveTick+(e.type==='bus'?0:9)})),
    seenCustomerIds:[...frame.seenCustomerIds].sort(),recentActions:input.recentActions.slice(-5).map(a=>({tick:a.tick,action:a.action})),
  };
  return createHash('sha256').update('hawker-wars|state-hash-1\n').update(canonicalState(envelope)).digest('hex');
}
