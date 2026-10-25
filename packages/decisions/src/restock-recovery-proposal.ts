import {DecisionInputSchema,POC_CONFIG,type DecisionInput} from '../../shared/src/index.ts';
import {effectiveRestockDueTick,getLegalActions} from '../../simulation/src/legality.ts';
export const RESTOCK_RECOVERY_VERSION='restock-recovery-shadow-1';
// Heuristic margin, not an optimality claim: leave at least ten service ticks.
export const MIN_RECOVERY_SERVICE_TICKS=10;
/** Offline proposal only. No production controller imports or applies this function. */
export function proposeRestockRecovery(value:DecisionInput,selected:DecisionInput['legalActions'][number]){
 const input=DecisionInputSchema.parse(value),o=input.observation;
 if(selected!=='WAIT'||!input.legalActions.includes('WAIT')||!input.legalActions.includes('RESTOCK')||!getLegalActions(o).includes('RESTOCK'))return null;
 if(o.rawPortions!==0||o.readyBatches.length!==0||o.cooking!==null||o.pendingRestock!==null)return null;
 const deliveryTick=effectiveRestockDueTick(o),earliestReadyTick=deliveryTick+POC_CONFIG.cookingMinutes;
 const serviceTicks=POC_CONFIG.closingTick-earliestReadyTick;
 if(serviceTicks<MIN_RECOVERY_SERVICE_TICKS)return null;
 return {version:RESTOCK_RECOVERY_VERSION,proposedAction:'RESTOCK' as const,reason:'empty-pipeline-with-service-window' as const,deliveryTick,earliestReadyTick,serviceTicks};
}
