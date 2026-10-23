import { ObservationSchema, DecisionInputSchema, type SimulatorState, type Observation, type DecisionInput } from '../../shared/src/index.js';
import { getLegalActions } from './legality.js';

type ActionSummary = Observation['recentActions'][number];
function publicCustomerId(id: string, arrivalTick: number): string {
  const match = /(?:^|\|)(customer-(?:0|[1-9]\d{0,2})-(?:base|bus|promotion)-(?:0|[1-9]\d?))$/.exec(id);
  if (!match || Number(match[1]!.split('-')[1]) !== arrivalTick) throw new Error('Customer lacks a stable public ID mapping');
  return match[1]!;
}
/** Copy allowlisted scalar fields. Private metadata never enters a provider request. */
export function projectObservation(state: SimulatorState, recentActions: readonly ActionSummary[] = []): Observation {
  if (state.phase !== 'decision') throw new Error('Observation requires a prepared decision boundary');
  return ObservationSchema.parse({
    schemaVersion: 'observation-2', tick: state.tick, remainingMinutes: 120-state.tick,
    cashCents: state.cashCents, rawPortions: state.rawPortions,
    readyBatches: state.readyBatches.map(b=>({id:b.id,quantity:b.quantity,expiresAt:b.expiresAt})),
    cooking: state.cooking ? {quantity:state.cooking.quantity,dueTick:state.cooking.dueTick}:null,
    pendingRestock:state.pendingRestock?{quantity:state.pendingRestock.quantity,dueTick:state.pendingRestock.dueTick,delayApplied:state.pendingRestock.delayApplied}:null,
    promotion:state.promotion?{startsAt:state.promotion.startsAt,endsAt:state.promotion.endsAt}:null,
    promotionEligibleAt:state.promotionEligibleAt,
    queue:state.queue.map(c=>({id:publicCustomerId(c.id,c.arrivalTick),arrivalTick:c.arrivalTick,patience:c.patience,deadlineTick:c.deadlineTick})),
    effects:state.effects.map(e=>({type:e.type,startsAt:e.startsAt,endsAt:e.endsAt})),
    demandPhase:state.tick>=30&&state.tick<=89?'peak':'off-peak',
    cumulativeRevenueCents:500*state.totals.served,cumulativePurchasesCents:4000*state.totals.restockOrders,cumulativePromotionSpendCents:500*state.totals.promotions,
    totals:{served:state.totals.served,abandoned:state.totals.abandoned,wasted:state.totals.wasted,waitMinutes:state.totals.waitMinutes,arrivals:state.totals.arrivals,purchasedPortions:state.totals.purchasedPortions,restockOrders:state.totals.restockOrders,promotions:state.totals.promotions},
    recentActions:recentActions.slice(-5).map(a=>({tick:a.tick,action:a.action})),legalActions:getLegalActions(state),
  });
}
export function decisionInput(state: SimulatorState, roundId: string, recentActions: readonly ActionSummary[]=[]):DecisionInput {
  const observation=projectObservation(state,recentActions);
  return DecisionInputSchema.parse({roundId,tick:state.tick,observation,legalActions:observation.legalActions});
}
