import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runEpisode, type EpisodeResult } from './offline-episode.js';
import { sourceIdentity } from './source-identity.js';
import { configurationHash } from './config-snapshot.js';
import { CONTRACT_VERSIONS } from '../packages/shared/src/config.js';
import type { DemandScenario } from '../packages/simulation/src/demand.js';
export const referencePath=fileURLToPath(new URL('../fixtures/reference/rules-development-1.json',import.meta.url));
export const referenceScenarios:DemandScenario[]=['clean','bus','rain','supplier-delay'];
export function episodeReference(result:EpisodeResult) {
  return {seed:result.seed,scenario:result.scenario,scheduleHash:result.scheduleHash,
    turns:result.trace.map(t=>({tick:t.tick,action:t.decision.appliedAction,origin:t.decision.origin,preparedHash:t.preparedHash,hash:t.hash})),
    finalHash:result.finalHash,traceHash:result.traceHash,score:result.score,metrics:result.metrics};
}
export function makeDevelopmentReference(){
  return {schemaVersion:'rules-development-reference-1',scope:'offline-development-only-no-live-provider-results',contracts:CONTRACT_VERSIONS,configurationHash,
    runtime:{node:process.versions.node,pinnedPackageManager:'pnpm@11.25.0'},sourceRevision:null,sourceRevisionStatus:'unborn-repository-using-source-content-digest',sourceIdentity:sourceIdentity(),
    hashEnvelope:'state-hash-1 includes explicit policy state, stage/tick, opening ledger, event/customer dedup context, last five actions, configuration and schedule identities; excludes UUIDs/latency/operational metadata',
    scenarios:referenceScenarios.map(scenario=>episodeReference(runEpisode({seed:0,scenario}))),
    networkCalls:0,trialManifestReferenceChecksumUnchanged:true};
}
export function verifyDevelopmentReference(){
  if(!existsSync(referencePath))throw new Error('Development reference missing; generate after reviewing fixture results');
  const actual=makeDevelopmentReference(),saved=JSON.parse(readFileSync(referencePath,'utf8')) as unknown;
  if(JSON.stringify(saved)!==JSON.stringify(actual))throw new Error('Development reference or source/toolchain identity differs; investigate and version intentional changes before regenerating');
  return actual;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv.slice(2).join(' ')==='--refresh-provenance'){
    const saved=JSON.parse(readFileSync(referencePath,'utf8')) as Record<string,unknown>;
    const actual=makeDevelopmentReference();
    const {sourceIdentity:previousSource,...previousBehavior}=saved;
    const {sourceIdentity:currentSource,...currentBehavior}=actual;
    if(JSON.stringify(previousBehavior)!==JSON.stringify(currentBehavior))throw new Error('Behavior changed; provenance-only refresh refused');
    writeFileSync(referencePath,JSON.stringify(actual,null,2)+'\n');
    console.log(JSON.stringify({status:'provenance-refreshed',behavioralReferencesUnchanged:true,previousSourceTreeHash:(previousSource as {sourceTreeHash:string}).sourceTreeHash,currentSourceTreeHash:currentSource.sourceTreeHash}));
  }else if(process.argv.slice(2).join(' ')==='--write'){
    const ref=makeDevelopmentReference();writeFileSync(referencePath,JSON.stringify(ref,null,2)+'\n');console.log(JSON.stringify({status:'development-reference-written',scenarios:ref.scenarios.length,sourceTreeHash:ref.sourceIdentity.sourceTreeHash}));
  }else if(process.argv.length===2){const ref=verifyDevelopmentReference();console.log(JSON.stringify({status:'development-reference-matches',scenarios:ref.scenarios.length}));}
  else throw new Error('Usage: pnpm reference:p2-a [--write|--refresh-provenance]');
}
