import { z } from 'zod';

export const LiveProviderSchema = z.enum(['jev', 'zoom', 'zoom-pro']);
export type LiveProvider = z.infer<typeof LiveProviderSchema>;
const ProviderSettingsSchema = z.object({
  activationRequested: z.boolean(),
  model: z.string().regex(/^[a-zA-Z0-9._:/-]{1,160}$/).nullable(),
  maximumRequestCost: z.object({
    micros: z.number().int().positive().max(250_000),
    currency: z.literal('USD'),
    evidenceUrl: z.string().url(),
    checkedAt: z.string().datetime(),
    // A request size restriction is separate from the provider's verified billing bound.
    maxRequestBytes: z.number().int().positive().max(65_536),
  }).strict().nullable(),
  freeTierVerified: z.boolean(),
  smoke: z.object({
    requestId: z.string().regex(/^[a-zA-Z0-9._:/-]{1,160}$/),
    requestedModel: z.string().min(1), returnedModel: z.string().min(1),
    checkedAt: z.string().datetime(),
  }).strict().nullable(),
}).strict();
export const ProviderRuntimeSchema = z.object({
  schemaVersion: z.literal('provider-runtime-1'),
  campaignId: z.literal('zoom-trial-campaign-1'),
  jevSpendApproval: z.object({
    perRunCapMicros: z.number().int().positive().safe(),
    campaignCapMicros: z.number().int().positive().safe(),
    approvalReference: z.string().min(1).max(512),
    scope: z.enum(['smoke', 'campaign']).optional(),
  }).strict().refine(b=>b.perRunCapMicros<=b.campaignCapMicros,'Run cap cannot exceed campaign cap').nullable(),
  zoomCampaignException: z.object({
    roundId: z.string().uuid(), approvalReference: z.string().min(1).max(512),
    allocationMicrosPerRequest: z.literal(1000), maxRequestBytes: z.literal(8192),
    priorSmokeAllocations: z.tuple([z.literal('docs/providers/zoom-smoke-result.json'),z.literal('docs/providers/zoom-pro-smoke-result.json')]),
  }).strict().optional(),
  providers: z.object({jev: ProviderSettingsSchema, zoom: ProviderSettingsSchema, 'zoom-pro': ProviderSettingsSchema}).strict(),
}).strict().superRefine((config, ctx) => {
  for (const provider of ['zoom', 'zoom-pro'] as const) {
    const expected = provider === 'zoom' ? 'zoom-decisions-standard' : 'zoom-decisions-pro';
    if (config.providers[provider].model !== expected) ctx.addIssue({code:'custom',message:'Zoom model selection must retain the requested policy identity'});
  }
});
export type ProviderRuntimeConfig = z.infer<typeof ProviderRuntimeSchema>;
export function activationBlockers(config: ProviderRuntimeConfig, provider: LiveProvider, mode: 'smoke'|'live'): string[] {
  const settings = ProviderRuntimeSchema.parse(config).providers[provider];
  const blockers: string[] = [];
  if (!settings.activationRequested) blockers.push('activation-not-requested');
  if (!settings.model) blockers.push('model-unverified');
  if (!settings.maximumRequestCost && !(provider !== 'jev' && mode === 'live' && config.zoomCampaignException)) blockers.push('maximum-request-charge-unverified');
  if (provider === 'jev') {
    if (mode === 'live' && config.jevSpendApproval?.scope !== 'campaign') blockers.push('jev-live-campaign-spend-unapproved');
    // Freemium alone cannot fund reservations. A future paid approval has its own pool.
    if (!config.jevSpendApproval) {
      if (!settings.freeTierVerified) blockers.push('free-tier-allowance-and-overage-unverified');
      blockers.push('jev-budget-or-enforceable-free-quota-unconfigured');
    }
  }
  const returnedModelValid = settings.smoke && (provider === 'zoom'
    ? ['zoom-decisions-standard','zoom-decisions'].includes(settings.smoke.returnedModel)
    : settings.smoke.returnedModel === settings.model);
  if (mode === 'live' && (!settings.smoke || settings.smoke.requestedModel !== settings.model || !returnedModelValid)) blockers.push('credentialed-smoke-pending');
  return blockers;
}

/** Operator allocation is not a verified cost bound; scope is enforced again by the ledger. */
export function requestAccounting(config:ProviderRuntimeConfig,provider:LiveProvider,mode:'live'|'smoke',roundId?:string) {
  const exception=config.zoomCampaignException;
  if(exception && roundId && roundId!==exception.roundId)return null;
  const bound=config.providers[provider].maximumRequestCost;
  if(bound)return {micros:bound.micros,maxRequestBytes:bound.maxRequestBytes,basis:'verified-bound' as const};
  if(provider!=='jev' && mode==='live' && exception)return {micros:exception.allocationMicrosPerRequest,maxRequestBytes:exception.maxRequestBytes,basis:'operator-allocation-unverified' as const};
  return null;
}
