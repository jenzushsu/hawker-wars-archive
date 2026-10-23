import { z } from 'zod';
import { FixtureStateSchema, TrialEvaluationPlanSchema } from '../packages/shared/src/index.js';
import { CONTRACT_VERSIONS, TRIAL_CONFIG, ACTIONS } from '../packages/shared/src/config.js';
import { configSnapshot, configurationHash, readProjectJson, canonicalConfig } from './config-snapshot.js';

const count = z.number().int().nonnegative().safe();
const json: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(json), z.record(json)]));
const versions = z.object(Object.fromEntries(Object.entries(CONTRACT_VERSIONS).map(([key, value]) => [key, z.literal(value)]))).strict();
const state = FixtureStateSchema;
const operation = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('action'),action:z.enum(ACTIONS),advanceThroughTick:count.optional(),futureArrivals:z.array(json).optional()}).strict(),
  z.object({kind:z.literal('legalActions')}).strict(),
  z.object({kind:z.literal('advanceTicks'),throughTick:count,futureArrivals:z.array(json)}).strict(),
  z.object({kind:z.literal('applyExternalEvent'),event:z.object({type:z.enum(['bus','rain','supplier-delay']),effectiveTick:count,endsAt:count}).strict(),reapplySameEvent:z.boolean()}).strict(),
  z.object({kind:z.literal('chooseRule')}).strict(),
  z.object({kind:z.literal('scoreSettlement')}).strict(),
  z.object({kind:z.literal('runEpisode'),actions:z.literal('WAIT'),futureArrivals:z.array(json),throughTick:count}).strict(),
  z.object({kind:z.literal('settle')}).strict(),
  z.object({kind:z.literal('rank'),metric:z.literal('profitCents'),results:z.array(z.object({policy:z.enum(['jev','zoom','zoom-pro','rules']),profitCents:z.number().int().safe(),latencyMs:count}).strict())}).strict(),
  z.object({kind:z.literal('providerFailure'),provider:z.enum(['jev','zoom','zoom-pro']),proposedAction:z.enum(ACTIONS),failureReason:z.enum(['illegal_action','timeout']),receivedAtMs:count,deadlineMs:z.literal(4000)}).strict(),
]);
export const FixtureSetSchema = z.object({
  fixtureSetVersion:z.literal('poc-1-acceptance-1'),contracts:versions,
  executionStatus:z.literal('expected-only-engine-not-implemented'),scope:z.string().min(1),
  syntheticLocalPolicy:z.object({openingLedger:z.string().min(1),history:z.string().min(1)}).strict(),
  defaults:state,
  cases:z.array(z.object({id:z.string().min(1),sourceId:z.string().min(1),category:z.enum(['mechanics','legality','boundary','baseline','scoring','ranking','fallback']),description:z.string().min(1),setupMode:z.enum(['synthetic-local','episode']),givenPhase:z.enum(['observation','before-tick']),given:state,operation,
    expectations:z.array(z.object({at:z.string().min(1),path:z.string().min(1),operator:z.enum(['equals','contains','notContains','containsSubset']),value:json}).strict()).min(1),
  }).strict()).min(1),
}).strict();
export function validateArtifacts() {
  const frozen=z.object({configurationHash:z.string().regex(/^[0-9a-f]{64}$/),configuration:json}).strict().parse(readProjectJson('manifests/p0-contract.json'));
  if(frozen.configurationHash!==configurationHash||canonicalConfig(frozen.configuration)!==canonicalConfig(configSnapshot)) throw new Error('Frozen configuration drift: review and version the change before regeneration');
  const fixtures=FixtureSetSchema.parse(readProjectJson('fixtures/poc-1-acceptance.json'));
  const ids=fixtures.cases.map(c=>c.id);
  if(new Set(ids).size!==ids.length) throw new Error('Duplicate fixture IDs');
  const sources=[...Array.from({length:10},(_,i)=>`MECH-${String(i+1).padStart(2,'0')}`),'MECH-11A','MECH-11B',...Array.from({length:5},(_,i)=>`RULE-${String(i+1).padStart(2,'0')}`),...Array.from({length:4},(_,i)=>`SCORE-${String(i+1).padStart(2,'0')}`),'FALL-01'];
  for(const id of sources) if(!fixtures.cases.some(c=>c.sourceId===id)) throw new Error(`Missing acceptance source ${id}`);
  const manifest=TrialEvaluationPlanSchema.parse(readProjectJson('manifests/trial-eval-1.json'));
  if(manifest.configurationHash!==configurationHash) throw new Error('Trial manifest configuration hash differs');
  if(manifest.referenceChecksum!==null||manifest.liveDispatchEnabled!==false) throw new Error('P0 cannot claim engine reference or enable live dispatch');
  const cohort=manifest.cohorts;
  const equal=(a:unknown,b:unknown)=>canonicalConfig(a)===canonicalConfig(b);
  if(!equal(cohort.clean.seeds,TRIAL_CONFIG.cleanSeeds)||!equal(cohort.stress.seeds,TRIAL_CONFIG.stressSeeds)||!equal(cohort.stress.stages.map(s=>s.seeds),TRIAL_CONFIG.stressStages)) throw new Error('Trial cohort/stage drift');
  const events=['bus','rain','supplier-delay'];
  for(const [i,event] of events.entries()) if(Object.values(cohort.stress.eventBySeedModulo3)[i]!==event||cohort.stress.seeds.filter(s=>s%3===i).length!==2) throw new Error('Stress event imbalance');
  const providers=manifest.providerPolicy;
  for(const id of ['jev','zoom','zoom-pro'] as const) if(providers[id]?.liveEnabled!==false||providers[id]?.verification!=='unverified') throw new Error('Unverified provider enabled');
  return {configurationHash, fixtureCount:fixtures.cases.length,sourceCount:sources.length,cleanSeeds:cohort.clean.seeds.length,stressSeeds:cohort.stress.seeds.length};
}
