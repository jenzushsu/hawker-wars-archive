import { createHash } from 'node:crypto';
import { canonicalState } from '../../simulation/src/hash.ts';
import { activationBlockers, requestAccounting, ProviderRuntimeSchema, type ProviderRuntimeConfig } from '../../providers/src/activation.ts';
import { createProviderAdapter } from '../../providers/src/adapter.ts';
import { PROVIDER_PROMPT_VERSION } from '../../providers/src/wire.ts';
import type { Ledger } from '../../providers/src/ledger.ts';
import type { MultiControllers } from './multi-worker.ts';

export function providerConfigurationHash(config: ProviderRuntimeConfig): string {
  return createHash('sha256').update('hawker-wars|live-provider-config-2\n').update(PROVIDER_PROMPT_VERSION+'\n').update(canonicalState(ProviderRuntimeSchema.parse(config))).digest('hex');
}
/** Configuration-only check. No account checks, reservations, or remote inference. */
export function multiProviderBlockers(config: ProviderRuntimeConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const parsed = ProviderRuntimeSchema.parse(config);
  return (['jev', 'zoom', 'zoom-pro'] as const).flatMap(provider => {
    const blockers = activationBlockers(parsed, provider, 'live');
    if (!env[provider === 'jev' ? 'TYPESAFE_API_KEY' : 'ZOOM_AI_SERVICES_API_KEY']) blockers.push('credential-unavailable');
    return blockers.map(blocker => `${provider}:${blocker}`);
  });
}
/** Existing ledger only. The operator must preserve all earlier campaign reservations. */
export function multiControllers(config: ProviderRuntimeConfig, ledger: Ledger): MultiControllers {
  const blockers = multiProviderBlockers(config);
  if (blockers.length) throw new Error('Multi-policy provider configuration is blocked');
  if (ledger.config.campaignId !== config.campaignId) throw new Error('Ledger campaign mismatch');
  ledger.validateStorage();
  const adapter = (provider: 'jev' | 'zoom' | 'zoom-pro') => {
    if (ledger.getCostBound(provider) !== requestAccounting(config,provider,'live')!.micros) throw new Error('Ledger request bound mismatch');
    const controller = createProviderAdapter({ provider, config, ledger });
    return { async decideTurn(input: Parameters<typeof controller.decideTurn>[0]) {
      const turn = await controller.decideTurn(input);
      if (turn.result.status === 'fallback') console.error(JSON.stringify({
        status: 'provider-fallback', roundId: input.roundId, tick: input.tick, provider,
        reason: turn.result.fallbackReason, diagnostic: turn.diagnostic,
        ...(turn.probabilityDiagnostic ? {probabilityDiagnostic:turn.probabilityDiagnostic} : {}),
        attemptCount: turn.attemptCount, legalActions: input.legalActions,
      }));
      return turn;
    } };

  };
  return { jev: adapter('jev'), zoom: adapter('zoom'), 'zoom-pro': adapter('zoom-pro') };
}
