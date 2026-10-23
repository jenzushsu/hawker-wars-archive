import { describe, expect, it } from 'vitest';
import { FixtureStateSchema, SimulatorStateSchema, type SimulatorState } from '../packages/shared/src/index.js';
import { createInitialFrame, prepareTick, applyAction, advanceTick, settle, applyExternalEvent, assertFrame } from '../packages/simulation/src/engine.js';
import { getLegalActions, effectiveRestockDueTick } from '../packages/simulation/src/legality.js';
import type { Customer, EngineFrame } from '../packages/simulation/src/types.js';

function boundary(overrides: Partial<SimulatorState>, stage: EngineFrame['stage'] = 'decision'): EngineFrame {
  const state = FixtureStateSchema.parse({ ...createInitialFrame().state, ...overrides, phase: stage === 'before-tick' ? 'committed' : stage });
  return {
    stage, boundaryTick: state.tick, state,
    ledger: {
      openingCashCents: state.cashCents - 500 * state.totals.served + 4000 * state.totals.restockOrders + 500 * state.totals.promotions,
      openingPortions: state.rawPortions + state.readyBatches.reduce((n,b)=>n+b.quantity,0) + (state.cooking?.quantity??0)+(state.pendingRestock?.quantity??0)+state.totals.served+state.totals.wasted-state.totals.purchasedPortions,
    },
    appliedEvents:[], seenCustomerIds:state.queue.map(c=>c.id), events:[],
  };
}
const customer=(tick:number, ordinal=0, patience=3):Customer=>({id:`customer-${tick}-base-${ordinal}`,arrivalTick:tick,patience,deadlineTick:tick+patience});
const totals=(arrivals:number)=>({...createInitialFrame().state.totals,arrivals});

describe('pure simulation lifecycle',()=>{
  it('initializes exact production opening state and prevents applying before preparation',()=>{
    const start=createInitialFrame();expect(start.stage).toBe('before-tick');expect(start.ledger).toEqual({openingCashCents:20000,openingPortions:42});
    expect(()=>applyAction(start,'WAIT')).toThrow();expect(()=>advanceTick(start)).toThrow();expect(()=>settle(start)).toThrow();
    expect(SimulatorStateSchema.safeParse(start.state).success).toBe(true);
  });
  it('returns frozen frames and never mutates input snapshots',()=>{
    const start=createInitialFrame(),serialized=JSON.stringify(start);
    const prepared=prepareTick(start,{arrivals:[customer(0)]});const served=applyAction(prepared,'SERVE');
    expect(JSON.stringify(start)).toBe(serialized);expect(start.state.queue).toEqual([]);
    expect(prepared.state.queue).toHaveLength(1);expect(served.state.queue).toHaveLength(0);
    expect(Object.isFrozen(served.state.totals)).toBe(true);
    expect(()=>Object.assign(served.state,{cashCents:1})).toThrow();
    expect(()=>applyAction(served,'WAIT')).toThrow();expect(()=>prepareTick(prepared)).toThrow();
  });
  it('rejects illegal actions without changing the decision boundary',()=>{
    const prepared=prepareTick(createInitialFrame()),snapshot=JSON.stringify(prepared);
    expect(()=>applyAction(prepared,'SERVE')).toThrow('Illegal action');expect(JSON.stringify(prepared)).toBe(snapshot);
  });
  it('rejects duplicate arrivals, wrong-tick arrivals and a corrupt opening ledger',()=>{
    const c=customer(0);
    expect(()=>prepareTick(createInitialFrame(),{arrivals:[c,c]})).toThrow('Duplicate');
    expect(()=>prepareTick(createInitialFrame(),{arrivals:[customer(1)]})).toThrow('this tick');
    const prepared=prepareTick(createInitialFrame(),{arrivals:[c]});const next=advanceTick(applyAction(prepared,'WAIT'));
    expect(()=>prepareTick(next,{arrivals:[{...c,arrivalTick:1,deadlineTick:4}]})).toThrow('Duplicate');
    const corrupt=structuredClone(createInitialFrame());corrupt.ledger.openingPortions=43;expect(()=>assertFrame(corrupt)).toThrow('ledger');
  });
  it('settles a complete no-demand WAIT episode exactly once',()=>{
    let f=createInitialFrame();const events=[];
    for(let tick=0;tick<120;tick++){
      f=prepareTick(f);events.push(...f.events);f=applyAction(f,'WAIT');f=advanceTick(f);
    }
    expect(f.stage).toBe('before-tick');expect(f.boundaryTick).toBe(120);
    expect(()=>prepareTick(f)).toThrow('Closing');
    f=settle(f);events.push(...f.events);
    expect(f.state).toMatchObject({phase:'closed',tick:120,cashCents:20000,rawPortions:30,queue:[],readyBatches:[],cooking:null,pendingRestock:null});
    expect(f.state.totals.wasted).toBe(12);expect(events.filter(e=>e.type==='ready-wasted')).toHaveLength(1);
    expect(()=>settle(f)).toThrow();expect(()=>advanceTick(f)).toThrow();expect(()=>applyAction(f,'WAIT')).toThrow();
  });
});

describe('economy and exact boundaries',()=>{
  it('serves earliest-expiring stock first and resolves each wait exactly once',()=>{
    const f=boundary({tick:10,readyBatches:[{id:'batch-1',quantity:1,expiresAt:12},{id:'batch-2',quantity:5,expiresAt:20}],queue:[customer(8,0,10),customer(9,0,10),customer(10,0,10)],totals:totals(3)});
    const r=applyAction(f,'SERVE');expect(r.state.readyBatches).toEqual([{id:'batch-2',quantity:3,expiresAt:20}]);
    expect(r.state.totals).toMatchObject({served:3,waitMinutes:3});expect(r.state.cashCents).toBe(21500);
    expect(r.events.filter(e=>e.type==='customer-resolved').map(e=>e.waitMinutes)).toEqual([2,1,0]);
  });
  it('completes cooking on t+5 without a second raw/cash charge',()=>{
    let f=boundary({tick:10,readyBatches:[{id:'batch-0',quantity:5,expiresAt:30}],rawPortions:10});
    f=applyAction(f,'COOK');expect(f.state).toMatchObject({rawPortions:0,cashCents:20000,cooking:{quantity:10,dueTick:15}});
    for(let t=11;t<=15;t++){f=prepareTick(advanceTick(f));if(t<15){expect(f.state.cooking).not.toBeNull();f=applyAction(f,'WAIT');}}
    expect(f.state.cooking).toBeNull();expect(f.state.readyBatches).toContainEqual({id:'batch-15',quantity:10,expiresAt:35});
  });
  it('expires ready food and patience before service choice',()=>{
    const f=boundary({tick:20,queue:[customer(17)],totals:totals(1)},'before-tick');const r=prepareTick(f);
    expect(r.state.readyBatches).toEqual([]);expect(r.state.queue).toEqual([]);expect(r.state.totals).toMatchObject({wasted:12,abandoned:1,waitMinutes:3});
    expect(getLegalActions(r.state)).not.toContain('SERVE');
  });
  it('charges restock once, reserves raw slots, and delays orders placed during a shock',()=>{
    const effect={type:'supplier-delay' as const,startsAt:100,endsAt:109};
    const f=boundary({tick:100,rawPortions:40,cashCents:4000,readyBatches:[],effects:[effect]});
    expect(effectiveRestockDueTick(f.state)).toBe(115);const r=applyAction(f,'RESTOCK');
    expect(r.state).toMatchObject({cashCents:0,rawPortions:40,pendingRestock:{quantity:20,dueTick:115,delayApplied:true}});
    expect(getLegalActions(r.state)).not.toContain('RESTOCK');
  });
  it('applies supplier delay before same-tick delivery and suppresses duplicate effect IDs',()=>{
    const input=boundary({tick:10,pendingRestock:{quantity:20,dueTick:10,delayApplied:false},rawPortions:20},'before-tick');
    const event={id:'shock-0',type:'supplier-delay' as const,effectiveTick:10};
    const once=applyExternalEvent(input,event),twice=applyExternalEvent(once,event);expect(twice.state.pendingRestock?.dueTick).toBe(15);
    const prepared=prepareTick(twice);expect(prepared.state.rawPortions).toBe(20);expect(prepared.state.pendingRestock?.dueTick).toBe(15);
    expect(()=>applyExternalEvent(once,{...event,type:'rain'})).toThrow('changed payload');
    expect(()=>applyExternalEvent(once,{...event,id:'shock-1'})).toThrow('one external');
  });
  it('cannot finish cooking or new supplier delivery at 120',()=>{
    expect(getLegalActions(boundary({tick:115,readyBatches:[]}).state)).not.toContain('COOK');
    expect(getLegalActions(boundary({tick:110,readyBatches:[]}).state)).not.toContain('RESTOCK');
    expect(getLegalActions(boundary({tick:114,readyBatches:[]}).state)).toContain('COOK');
    expect(getLegalActions(boundary({tick:109,readyBatches:[]}).state)).toContain('RESTOCK');
  });
});
