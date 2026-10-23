import { LegalActionsSchema, type Observation, type SimulatorState } from '../../shared/src/schemas.js';
import { RULES_CONFIG } from '../../shared/src/config.js';

export type Action = Observation['legalActions'][number];
export type RulesState = Pick<SimulatorState, 'tick' | 'readyBatches' | 'rawPortions' | 'cooking' | 'pendingRestock' | 'queue'>;
export interface RuleChoice { action: Action; rulePriority: number }

/** Frozen rules-1: first matching rule whose action is in the captured legal set. */
export function chooseRules(state: RulesState, legalActions: readonly Action[]): RuleChoice {
  const legal = LegalActionsSchema.parse(legalActions);
  if (!Number.isSafeInteger(state.tick) || state.tick < 0 || state.tick > 119) throw new Error('Rules requires an active decision tick');
  const ready = state.readyBatches.reduce((sum, batch) => sum + batch.quantity, 0);
  const queue = state.queue.length;
  const remaining = 120 - state.tick;
  const pipeline = state.rawPortions + (state.cooking?.quantity ?? 0) + (state.pendingRestock?.quantity ?? 0);
  const head = state.queue[0];
  for (const rule of RULES_CONFIG.orderedRules) {
    if (!legal.includes(rule.action)) continue;
    const condition: Partial<Record<'queueAbove'|'readyAbove'|'headDeadlineWithin'|'readyAtMost'|'remainingAtLeast'|'pipelineAtMost'|'queueAtMost'|'readyAtLeast', number>> = rule.condition;
    if (condition.queueAbove !== undefined && queue <= condition.queueAbove) continue;
    if (condition.readyAbove !== undefined && ready <= condition.readyAbove) continue;
    if (condition.headDeadlineWithin !== undefined && (!head || head.deadlineTick - state.tick > condition.headDeadlineWithin)) continue;
    if (condition.readyAtMost !== undefined && ready > condition.readyAtMost) continue;
    if (condition.remainingAtLeast !== undefined && remaining < condition.remainingAtLeast) continue;
    if (condition.pipelineAtMost !== undefined && pipeline > condition.pipelineAtMost) continue;
    if (condition.queueAtMost !== undefined && queue > condition.queueAtMost) continue;
    if (condition.readyAtLeast !== undefined && ready < condition.readyAtLeast) continue;
    return { action: rule.action, rulePriority: rule.priority };
  }
  throw new Error('rules-1 must terminate with legal WAIT');
}
