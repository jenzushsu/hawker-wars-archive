import type {Observation} from '../../shared/src/index.js';
import type {Action} from './rules.js';

export type ShortPlan = 'RESTOCK'|'WAIT';

/** Executes the exact one-order plans used in the captured-state experiment. */
export function createShortPlanExecutor(startTick:number,plan:ShortPlan) {
  if(!Number.isInteger(startTick)||startTick<0||startTick>=120)throw new Error('Invalid plan start');
  if(plan!=='RESTOCK'&&plan!=='WAIT')throw new Error('Unknown short plan');
  const orderTick=startTick+(plan==='WAIT'?10:0);
  let nextTick=startTick,ordered=false;
  return {
    decide(observation:Observation):Action {
      if(observation.tick!==nextTick)throw new Error('Plan requires consecutive observations');
      const legal=observation.legalActions;
      if(nextTick===startTick && (observation.rawPortions || observation.readyBatches.length || observation.cooking || observation.pendingRestock))throw new Error('Plan requires an empty pipeline');
      nextTick++;
      if(observation.tick<orderTick)return 'WAIT';
      if(observation.tick===orderTick) {
        ordered=legal.includes('RESTOCK');
        return ordered?'RESTOCK':'WAIT';
      }
      if(!ordered)return 'WAIT';
      if(legal.includes('SERVE'))return 'SERVE';
      if(legal.includes('COOK'))return 'COOK';
      return 'WAIT';
    },
  };
}
