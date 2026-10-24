import type { DecisionInput } from '../../shared/src/index.js';
import { buildRequest, type WireProvider, type WireRequest } from './wire.js';

/** Experiment only. Production adapter continues to call buildRequest directly. */
export function buildPlanningExperimentRequest(provider: WireProvider, input: DecisionInput, variant: 'baseline'|'planning', jevModel: string): WireRequest {
  const request = buildRequest(provider,input,jevModel);
  if (variant === 'baseline') return request;
  const criteria = {
    SERVE: 'Convert ready food and waiting customers into sales before patience or food expires.',
    COOK: 'Convert raw stock into ready food after 5 minutes; consider customers arriving by completion and expiry.',
    RESTOCK: 'Replenish the raw-stock pipeline for future cooking and service. Current customers may leave before delivery; consider future arrivals too. Unused raw stock retains 200 cents per portion at closing.',
    PROMOTE: 'Buy additional demand only when the food pipeline and time remaining can support it.',
    WAIT: 'Allow an existing delivery or cooking process to progress, or conserve resources when action has no expected benefit. Waiting alone never replenishes, cooks or serves.',
  };
  const shared = [
    'Evaluate the next 20 minutes and the final closing value. Compare feasible action sequences, including RESTOCK then COOK then SERVE, rather than only immediate effects.',
    'Do not assume the current queue is the only future demand. Use public demand rates, not hidden future arrivals.',
    'If delivery or cooking would finish too late to serve, account for retained raw stock and ready-food waste. WAIT can be appropriate; no action is mandatory.',
    ...input.legalActions.map(action => `${action}: ${criteria[action]}`),
  ].join('\n');
  if (provider === 'jev') {
    const question = (request.body.questions as {action:{instructions:string; criteria:Record<string,unknown>}}).action;
    question.instructions += '\n'+shared;
    question.criteria = Object.fromEntries(input.legalActions.map(action => [action,criteria[action]]));
  } else {
    const question = (request.body.questions as {instructions:string}[])[0]!;
    question.instructions += '\n'+shared;
  }
  return request;
}
