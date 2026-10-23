import { z } from 'zod';
import { FixtureSetSchema } from '../../scripts/p0-artifacts.js';
import { readProjectJson } from '../../scripts/config-snapshot.js';
import { FixtureStateSchema } from '../../packages/shared/src/index.js';
import { advanceTick, applyAction, applyExternalEvent, prepareTick, settle } from '../../packages/simulation/src/engine.js';
import { getLegalActions, effectiveRestockDueTick as computedRestockDueTick } from '../../packages/simulation/src/legality.js';
import type { EngineFrame, EngineEvent } from '../../packages/simulation/src/types.js';
import { scoreState, rankResults } from '../../packages/simulation/src/scoring.js';
import { chooseRules, resolveMockOutcome } from '../../packages/decisions/src/index.js';

export const acceptanceFixtures = FixtureSetSchema.parse(readProjectJson('fixtures/poc-1-acceptance.json'));
export type AcceptanceFixture = z.infer<typeof FixtureSetSchema>['cases'][number];
export type Projection = Record<string, unknown>;
export interface FixtureExecution { snapshots: Map<string, Projection>; assertionCount: number }

/** Test-only local opening ledger; no production invariant can be disabled by this helper. */
function fixtureFrame(fixture: AcceptanceFixture): EngineFrame {
  const state = FixtureStateSchema.parse(structuredClone(fixture.given));
  const quantities = state.rawPortions + state.readyBatches.reduce((n,b)=>n+b.quantity,0)
    + (state.cooking?.quantity??0) + (state.pendingRestock?.quantity??0)
    + state.totals.served + state.totals.wasted - state.totals.purchasedPortions;
  return {
    stage: fixture.givenPhase === 'observation' ? 'decision' : (state.phase === 'closed' ? 'closed' : 'before-tick'),
    state, boundaryTick: state.tick,
    ledger: {
      openingCashCents: fixture.setupMode==='episode'?20000:state.cashCents - 500*state.totals.served + 4000*state.totals.restockOrders + 500*state.totals.promotions,
      openingPortions: fixture.setupMode==='episode'?42:quantities,
    },
    appliedEvents: [], seenCustomerIds: state.queue.map(c=>c.id), events: [],
  };
}
function eventProjection(events: readonly EngineEvent[]): Projection {
  const resolved = events.filter(e=>e.type==='customer-resolved');
  return {
    servedCustomerIds: resolved.filter(e=>e.outcome==='served').map(e=>e.customerId),
    abandonmentReasons: resolved.filter(e=>e.outcome!=='served').map(e=>e.outcome),
    abandonments: resolved.filter(e=>e.outcome!=='served').map(e=>({id:e.customerId,reason:e.outcome,waitMinutes:e.waitMinutes})),
  };
}
function projection(frame: EngineFrame): Projection {
  const s=frame.state;
  return {
    state: {...s, readyPortions:s.readyBatches.reduce((n,b)=>n+b.quantity,0),queueIds:s.queue.map(c=>c.id),queueLength:s.queue.length},
    events:eventProjection(frame.events),
    ...(frame.stage==='decision'||frame.stage==='committed' ? {legalActions:getLegalActions(s)}:{}),
    computedRestockDueTick:computedRestockDueTick(s),
    promotionEligibleTicks:s.promotion?Array.from({length:s.promotion.endsAt-s.promotion.startsAt+1},(_,i)=>s.promotion!.startsAt+i):[],
    promotionNextAllowedTick:s.promotionEligibleAt,
  };
}
const ArrivalSchema=z.object({tick:z.number().int(),id:z.string(),arrivalTick:z.number().int(),patience:z.number().int(),deadlineTick:z.number().int(),source:z.enum(['base','bus','promotion'])}).strict();
function arrivalsFor(values: readonly unknown[],tick:number) {
  return values.map(value=>ArrivalSchema.parse(value)).filter(a=>a.tick===tick).map(({id,arrivalTick,patience,deadlineTick})=>({id,arrivalTick,patience,deadlineTick}));
}
/** Execute real transition/policy/scoring functions; expected values are never used to construct outputs. */
export function executeAcceptanceFixture(fixture: AcceptanceFixture): FixtureExecution {
  let frame=fixtureFrame(fixture);
  const snapshots=new Map<string,Projection>();
  const snap=(at:string,extra:Projection={})=>snapshots.set(at,{...projection(frame),...extra});
  const advanceTo=(target:number,arrivals: readonly unknown[])=>{
    while(frame.boundaryTick<=target) {
      if(frame.stage==='committed') frame=advanceTick(frame);
      if(frame.stage==='before-tick'&&frame.boundaryTick<120) {
        frame=prepareTick(frame,{arrivals:arrivalsFor(arrivals,frame.boundaryTick)});
        snap(`tick-${frame.boundaryTick}-observation`);
      }
      if(frame.boundaryTick===120) {
        frame=settle(frame); snap('settled',scoreState(frame.state)); break;
      }
      if(frame.boundaryTick===target) break;
      frame=applyAction(frame,'WAIT');
    }
  };
  const op=fixture.operation;
  switch(op.kind) {
    case 'action':
      frame=applyAction(frame,op.action);snap('after-action');
      if(op.advanceThroughTick!==undefined)advanceTo(op.advanceThroughTick,op.futureArrivals??[]);
      break;
    case 'legalActions':snap('observation');break;
    case 'advanceTicks':advanceTo(op.throughTick,op.futureArrivals);break;
    case 'applyExternalEvent': {
      const event={...op.event,id:`fixture-event-${fixture.id}`};
      frame=applyExternalEvent(frame,event);
      if(op.reapplySameEvent)frame=applyExternalEvent(frame,event);
      snap('after-event');break;
    }
    case 'chooseRule': {
      const legalActions=getLegalActions(frame.state);
      const selected=chooseRules(frame.state,legalActions);
      snap('observation',{legalActions});
      snap('decision',{action:selected.action,matchedRulePriority:selected.rulePriority});break;
    }
    case 'scoreSettlement': {
      const s=frame.state;
      snap('settled',{
        ...scoreState(s),
        inventoryConservation:42+s.totals.purchasedPortions===s.rawPortions+s.readyBatches.reduce((n,b)=>n+b.quantity,0)+(s.cooking?.quantity??0)+(s.pendingRestock?.quantity??0)+s.totals.served+s.totals.wasted,
        cashConservation:s.cashCents===20000+500*s.totals.served-4000*s.totals.restockOrders-500*s.totals.promotions,
      });break;
    }
    case 'runEpisode':advanceTo(op.throughTick,op.futureArrivals);break;
    case 'settle': {
      const beforeUtility=scoreState(frame.state).utilityPoints;
      frame=settle(frame);
      snap('settled',{customerUtilityDelta:scoreState(frame.state).utilityPoints-beforeUtility});
      break;
    }
    case 'rank': {
      const ranks=Object.fromEntries(rankResults(op.results,op.metric).map(r=>[r.policy,r.rank]));
      snap('ranked',{ranks});break;
    }
    case 'providerFailure': {
      const outcome=resolveMockOutcome({state:frame.state,legalActions:getLegalActions(frame.state),provider:op.provider,
        outcome:{kind:'response',response:{provider:op.provider,action:op.proposedAction,status:'success',latencyMs:op.receivedAtMs},elapsedMs:op.receivedAtMs},
      });
      snap('decision',{...outcome});break;
    }
    default: {
      const neverOperation:never=op;throw new Error(`Unsupported fixture operation ${String(neverOperation)}`);
    }
  }
  return {snapshots,assertionCount:fixture.expectations.length};
}
export function valueAtPath(root:unknown,path:string):unknown {
  let value=root;
  for(const key of path.split('.')) {
    if(value===null||typeof value!=='object'||!(key in value))throw new Error(`Missing result path ${path}`);
    value=(value as Record<string,unknown>)[key];
  }
  return value;
}
