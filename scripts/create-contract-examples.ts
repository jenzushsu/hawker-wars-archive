import { writeFileSync } from 'node:fs';
import { CONTRACT_VERSIONS, TRIAL_CONFIG, RunManifestSchema, ObservationSchema, ProviderEvidenceSchema } from '../packages/shared/src/index.js';
import { configurationHash } from './config-snapshot.js';
const manifest = RunManifestSchema.parse({
 schemaVersion:'manifest-1', manifestId:'p0-offline-contract',classification:'offline-contract',sourceRevision:null,
 contracts:CONTRACT_VERSIONS,configurationHash,
 seedCohorts:{development:TRIAL_CONFIG.developmentSeeds,clean:TRIAL_CONFIG.cleanSeeds,stress:TRIAL_CONFIG.stressSeeds,staticDevelopment:TRIAL_CONFIG.staticDevelopmentSeeds,staticHeldOut:TRIAL_CONFIG.staticHeldOutSeeds},
 stressStages:TRIAL_CONFIG.stressStages,stressEventTick:60,policies:['jev','zoom','zoom-pro','rules'],liveDispatchEnabled:false,
 providerRequestLimit:120,retries:0,deadlineMs:4000,status:'planned',
});
const observation=ObservationSchema.parse({
 schemaVersion:'observation-2',tick:0,remainingMinutes:120,cashCents:20000,rawPortions:30,
 readyBatches:[{id:'batch-0',quantity:12,expiresAt:20}],cooking:null,pendingRestock:null,promotion:null,promotionEligibleAt:0,
 queue:[],effects:[],demandPhase:'off-peak',cumulativeRevenueCents:0,cumulativePurchasesCents:0,cumulativePromotionSpendCents:0,
 totals:{served:0,abandoned:0,wasted:0,waitMinutes:0,arrivals:0,purchasedPortions:0,restockOrders:0,promotions:0},
 recentActions:[],legalActions:['COOK','RESTOCK','PROMOTE','WAIT'],
});
const registry=['jev','zoom','zoom-pro'].map(provider=>ProviderEvidenceSchema.parse({provider,status:'not-verified',liveDispatchEnabled:false,evidence:null}));
for(const [path,data] of [['manifests/p0-offline-run.json',manifest],['fixtures/observation-2-initial.json',observation],['manifests/providers-disabled.json',registry]] as const) writeFileSync(path,JSON.stringify(data,null,2)+'\n');
