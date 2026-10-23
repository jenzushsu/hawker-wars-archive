import { ACTIONS, POC_CONFIG, type Observation, type SimulatorState } from '../../shared/src/index.js';
import type { Action } from './types.js';

type LegalityState = Pick<SimulatorState | Observation,
  'tick' | 'cashCents' | 'rawPortions' | 'readyBatches' | 'cooking' | 'pendingRestock' | 'promotion' | 'promotionEligibleAt' | 'queue' | 'effects'>;

export function readyPortions(state: Pick<LegalityState, 'readyBatches'>): number {
  return state.readyBatches.reduce((sum, batch) => sum + batch.quantity, 0);
}
export function effectiveRestockDueTick(state: Pick<LegalityState, 'tick' | 'effects'>): number {
  const delay = state.effects.some(effect => effect.type === 'supplier-delay' && effect.startsAt <= state.tick && effect.endsAt >= state.tick);
  return state.tick + POC_CONFIG.restockMinutes + (delay ? 5 : 0);
}
/** Compute legal actions at a prepared decision boundary; terminal states have none. */
export function getLegalActions(state: LegalityState): Action[] {
  if (!Number.isInteger(state.tick) || state.tick < 0 || state.tick > 120) throw new Error('Invalid decision tick');
  if (state.tick === 120) return [];
  const ready = state.readyBatches.reduce((sum, batch) => sum + (batch.expiresAt > state.tick ? batch.quantity : 0), 0);
  const cookReserved = state.cooking?.quantity ?? 0;
  const pendingRaw = state.pendingRestock?.quantity ?? 0;
  const conditions: Record<Action, boolean> = {
    SERVE: state.queue.some(customer => customer.deadlineTick > state.tick) && ready > 0,
    COOK: state.cooking === null && state.rawPortions >= 10 && ready + cookReserved + 10 <= 30 && state.tick + 5 < 120,
    RESTOCK: state.pendingRestock === null && state.cashCents >= 4000 && state.rawPortions + pendingRaw + 20 <= 60 && effectiveRestockDueTick(state) < 120,
    PROMOTE: state.cashCents >= 500 && state.queue.length <= 5 && ready >= 10 && state.promotion === null && state.tick >= state.promotionEligibleAt && state.tick + 10 < 120,
    WAIT: true,
  };
  return ACTIONS.filter(action => conditions[action]);
}
