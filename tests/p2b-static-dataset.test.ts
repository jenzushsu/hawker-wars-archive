import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { generateStaticCandidates, STATIC_TASK_MANIFEST, StaticTaskSchema, canonicalStaticStateHash } from '../packages/benchmark/src/static-tasks.js';
import { evaluateDataset, StaticDatasetSchema, StaticLabeledTaskSchema, freezeStaticDataset, loadStaticDataset, staticDatasetHash, staticManifestHash } from '../packages/benchmark/src/static-dataset.js';
import { projectObservation } from '../packages/simulation/src/observation.js';
import { canonicalState } from '../packages/simulation/src/hash.js';

const generation=generateStaticCandidates();
const dataset=evaluateDataset(generation,{maxStates:200,maxBranches:200});
function repairHash<T extends Record<string,unknown>>(value:T):T {return {...value,datasetHash:staticDatasetHash(value)};}

describe('P2-B preregistered tiny static task generation and freeze',()=>{
 it('matches the checked manifest before labels are consulted',()=>{
  const checked=JSON.parse(readFileSync(new URL('../manifests/static-task-1.json',import.meta.url),'utf8')) as {manifest:unknown;manifestHash:string};
  expect(canonicalState(checked.manifest)).toBe(canonicalState(STATIC_TASK_MANIFEST));expect(checked.manifestHash).toBe(staticManifestHash());
  expect(Object.isFrozen(STATIC_TASK_MANIFEST.developmentGeneratorSeeds)).toBe(true);
 });
 it('captures reachable development prefix states at each declared tick',()=>{
  expect(generation.generatedCount).toBe(12);expect(generation.candidates.length+generation.duplicateRejections.length).toBe(12);
  for(const task of generation.candidates){
   expect(StaticTaskSchema.safeParse(task).success).toBe(true);
   expect(task.generator.seed>=2000&&task.generator.seed<=2099).toBe(true);
   expect(task.initialState.tick).toBe(task.generator.tick);expect(task.initialState.phase).toBe('decision');
   expect(task.observation).toEqual(projectObservation(task.initialState,task.observation.recentActions));
   expect(task).not.toHaveProperty('oracle');
  }
 });
 it('repeats deterministic generator hashes without evaluating held-out tasks',()=>{
  const repeated=generateStaticCandidates();
  expect(repeated).toEqual(generation);
 });
 it('requires explicit held-out opt-in and rejects seeds in the wrong split',()=>{
  expect(()=>generateStaticCandidates({split:'held-out',seeds:[3000]})).toThrow(/opt-in/);
  expect(()=>generateStaticCandidates({split:'development',seeds:[3000]})).toThrow(/split/);
  expect(()=>generateStaticCandidates({split:'development',seeds:[2000,2000]})).toThrow(/unique/);
  expect(()=>generateStaticCandidates({behaviorPolicies:['rules','rules']})).toThrow(/unique/);
 });
 it('normalizes cosmetic batch IDs so they cannot evade state deduplication',()=>{
  const task=generation.candidates.find(t=>t.initialState.readyBatches.length>0)!;
  expect(task).toBeDefined();
  const renamed=structuredClone(task.initialState);renamed.readyBatches=renamed.readyBatches.map((b,i)=>({...b,id:`cosmetic-${i}`}));
  expect(canonicalStaticStateHash(renamed)).toBe(task.canonicalStateHash);
 });
 it('rejects invalid state-to-observation mappings without escaping safeParse',()=>{
  const source=generation.candidates.find(t=>t.initialState.queue.length>0)!;
  expect(source).toBeDefined();const altered=structuredClone(source);
  altered.initialState.queue[0]!.id='private-seed-2000-customer';
  expect(()=>StaticTaskSchema.safeParse(altered)).not.toThrow();
  expect(StaticTaskSchema.safeParse(altered).success).toBe(false);
 });
 it('excludes known opposite-split canonical states before oracle evaluation',()=>{
  const excluded=generation.candidates.map(t=>t.canonicalStateHash);
  const filtered=generateStaticCandidates({excludeCanonicalStateHashes:excluded});
  expect(filtered.candidates).toHaveLength(0);expect(filtered.duplicateRejections).toHaveLength(12);
  expect(filtered.excludedCanonicalStateHashes).toEqual(excluded);
 });
 it('records every capped task and never emits an approximate label',()=>{
  expect(dataset.counts.generated).toBe(12);expect(dataset.counts.exactLabeled+dataset.counts.oracleRejected).toBe(12);
  expect(dataset.records.length).toBeGreaterThan(0);expect(dataset.rejections.length).toBeGreaterThan(0);
  for(const rejected of dataset.rejections)expect(rejected.reason).toBe('oracle-limit');
  for(const record of dataset.records)expect(record.oracle.status).toBe('exact');
  expect(dataset.solverLimits).toEqual({maxStates:200,maxBranches:200});
 });
 it('freezes and reloads exact rational reference sets without changing identities',()=>{
  const frozen=freezeStaticDataset(dataset);expect(loadStaticDataset(frozen)).toEqual(dataset);
  expect(freezeStaticDataset(loadStaticDataset(frozen))).toBe(frozen);
 });
 it('rejects changed data even with otherwise valid shapes',()=>{
  const altered=structuredClone(dataset);altered.counts.exactLabeled++;
  expect(StaticDatasetSchema.safeParse(altered).success).toBe(false);
  expect(StaticDatasetSchema.safeParse(repairHash(altered)).success).toBe(false);
 });
 it('rejects cross-split provenance even after a content hash is repaired',()=>{
  const changed=structuredClone(dataset);changed.split='held-out';
  expect(StaticDatasetSchema.safeParse(repairHash(changed)).success).toBe(false);
 });
 it('rejects omission of legal action evaluations or an optimal action',()=>{
  const record=dataset.records.find(r=>r.task.legalActions.length>1)!;expect(record).toBeDefined();
  const changed=structuredClone(record);changed.oracle.actionValues.pop();
  expect(StaticLabeledTaskSchema.safeParse(changed).success).toBe(false);
  const illegal=structuredClone(record);illegal.oracle.optimalActions=['COOK'];
  expect(StaticLabeledTaskSchema.safeParse(illegal).success).toBe(false);
 });
 it('rejects incorrect remaining-utility arithmetic for the task state',()=>{
  const record=structuredClone(dataset.records[0]!);
  record.oracle.actionValues[0]!.expectedRemainingUtility={numerator:'999999',denominator:'1'};
  expect(StaticLabeledTaskSchema.safeParse(record).success).toBe(false);
 });
 it('rejects fabricated rejection IDs and exclusion hashes even with repaired digest',()=>{
  const altered=structuredClone(dataset);altered.rejections[0]!.taskId='fabricated';
  expect(StaticDatasetSchema.safeParse(repairHash(altered)).success).toBe(false);
  const leaked=structuredClone(dataset);leaked.generation.excludedCanonicalStateHashes=[leaked.records[0]!.task.canonicalStateHash];
  expect(StaticDatasetSchema.safeParse(repairHash(leaked)).success).toBe(false);
 });
});
