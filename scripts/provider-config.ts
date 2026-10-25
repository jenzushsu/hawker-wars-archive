import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProviderRuntimeSchema, activationBlockers, type LiveProvider, type ProviderRuntimeConfig } from '../packages/providers/src/activation.js';
import type { LedgerConfig } from '../packages/providers/src/ledger.js';
import { configurationHash } from './config-snapshot.js';

export const runtimeConfigPath = fileURLToPath(new URL('../manifests/provider-runtime.json',import.meta.url));
export const ledgerDirectory = fileURLToPath(new URL('../results/live-provider-campaign',import.meta.url));
export const readRuntimeConfig = ()=>{const config=JSON.parse(readFileSync(process.env.HAWKER_PROVIDER_RUNTIME_FILE ?? runtimeConfigPath,'utf8'));if(process.env.HAWKER_CAMPAIGN_EXCEPTION_FILE)config.zoomCampaignException=JSON.parse(readFileSync(process.env.HAWKER_CAMPAIGN_EXCEPTION_FILE,'utf8'));return ProviderRuntimeSchema.parse(config);};
export function makeLedgerConfig(config: ProviderRuntimeConfig): LedgerConfig {
  const verifiedCostBounds: LedgerConfig['verifiedCostBounds']={};
  for (const provider of ['zoom','zoom-pro',...(config.jevSpendApproval?['jev' as const]:[])] as const) {
    const bound=config.providers[provider].maximumRequestCost;
    if(bound)verifiedCostBounds[provider]={costBoundMicros:bound.micros,evidenceId:bound.evidenceUrl};
  }
  return {schemaVersion:'provider-ledger-1',campaignId:config.campaignId,
    configurationHash:createHash('sha256').update(JSON.stringify({configurationHash,verifiedCostBounds,models:{zoom:config.providers.zoom.model,pro:config.providers['zoom-pro'].model,jev:config.providers.jev.model},jevSpendApproval:config.jevSpendApproval,...(config.zoomCampaignException?{zoomCampaignException:config.zoomCampaignException}:{})})).digest('hex'),
    pools:[{id:'zoom-shared',providers:['zoom','zoom-pro'],perRunCapMicros:250000,campaignCapMicros:5000000,...(config.zoomCampaignException?{priorExposure:config.zoomCampaignException.priorSmokeAllocations.map(evidenceId=>({micros:1000,evidenceId}))}:{})},
      ...(config.jevSpendApproval?[{id:'jev-separate',providers:['jev' as const],perRunCapMicros:config.jevSpendApproval.perRunCapMicros,campaignCapMicros:config.jevSpendApproval.campaignCapMicros}]:[])],verifiedCostBounds,...(config.zoomCampaignException?{allowedRunId:config.zoomCampaignException.roundId,unverifiedAllocations:{zoom:{costBoundMicros:1000,evidenceId:config.zoomCampaignException.approvalReference},'zoom-pro':{costBoundMicros:1000,evidenceId:config.zoomCampaignException.approvalReference}}}:{})};
}
export function networkSnapshotBlockers(provider: LiveProvider): string[] {
  const path='/etc/codex/network-policy.json';
  if(!existsSync(path))return [];
  try {
    const policy=JSON.parse(readFileSync(path,'utf8')) as {http_network_policy?:{type?:string;egress_rules?:{host:string}[]}};
    const host=provider==='jev'?'api.typesafe.ai':'api.zoom.us';
    if(policy.http_network_policy?.type==='unrestricted')return [];
    if(policy.http_network_policy?.type==='restricted'&&policy.http_network_policy.egress_rules?.some(rule=>rule.host===host||rule.host==='*'||rule.host.startsWith('*.')&&host.endsWith(rule.host.slice(1))))return [];
    return [`network-policy-does-not-allow-${host}`];
  } catch {return ['network-policy-unreadable'];}
}
export function providerStatus(config: ProviderRuntimeConfig, provider: LiveProvider) {
  const envName=provider==='jev'?'TYPESAFE_API_KEY':'ZOOM_AI_SERVICES_API_KEY';
  const credentialPresent=Boolean(process.env[envName]);
  const common=[...networkSnapshotBlockers(provider),...(!credentialPresent?['credential-unavailable']:[])];
  const smokeBlockers=[...activationBlockers(config,provider,'smoke'),...common];
  const liveBlockers=[...activationBlockers(config,provider,'live'),...common];
  return {provider,activationRequested:config.providers[provider].activationRequested,adapterImplemented:true,
    credentialVariable:envName,credentialPresent,authenticationVerified:!liveBlockers.includes('credentialed-smoke-pending'),
    smokeReady:smokeBlockers.length===0,liveDispatchEnabled:liveBlockers.length===0,
    smokeBlockers,liveBlockers};
}
