import { createHash } from 'node:crypto';
import { z } from 'zod';
import { scoreState } from '../../simulation/src/scoring.js';
import { canonicalState } from '../../simulation/src/hash.js';
import { ExactOracleResultSchema, OracleLimitError, solveStaticTask, ORACLE_DISTRIBUTION, type ExactOracleResult, type OracleLimits } from './oracle.js';
import { deserializeRational, compare, subtract, rational } from './rational.js';
import { StaticSplitSchema, BehaviorPolicySchema, StaticTaskSchema, STATIC_TASK_MANIFEST, type StaticCandidateGeneration, type StaticTask } from './static-tasks.js';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const count=z.number().int().safe().nonnegative();
export const StaticLabeledTaskSchema=z.object({task:StaticTaskSchema,oracle:ExactOracleResultSchema}).strict().superRefine(({task,oracle},ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(JSON.stringify(oracle.actionValues.map(v=>v.action))!==JSON.stringify(task.legalActions))issue('Oracle must evaluate every captured legal action in canonical order');
  if(new Set(oracle.optimalActions).size!==oracle.optimalActions.length)issue('Optimal actions must be unique');
  const sunk=rational(scoreState(task.initialState).utilityPoints);
  if(oracle.actionValues.some(value=>compare(deserializeRational(value.expectedRemainingUtility),subtract(deserializeRational(value.expectedFinalUtility),sunk))!==0))issue('Remaining utility must subtract this task state’s sunk utility exactly');
  let best=oracle.actionValues[0];
  for(const value of oracle.actionValues)if(best&&compare(deserializeRational(value.expectedFinalUtility),deserializeRational(best.expectedFinalUtility))>0)best=value;
  if(best){
    const expected=oracle.actionValues.filter(value=>compare(deserializeRational(value.expectedFinalUtility),deserializeRational(best!.expectedFinalUtility))===0).map(value=>value.action);
    if(JSON.stringify(expected)!==JSON.stringify(oracle.optimalActions))issue('Reference set must retain every exact maximizing action');
  }
});
export type StaticLabeledTask=z.infer<typeof StaticLabeledTaskSchema>;
const duplicate=z.object({taskId:z.string().min(1),canonicalStateHash:hash,reason:z.literal('duplicate-canonical-state')}).strict();
const capRejection=z.object({taskId:z.string().min(1),canonicalStateHash:hash,reason:z.literal('oracle-limit'),limitKind:z.enum(['states','branches']),exploredStates:count,exploredBranches:count}).strict();
const ManifestSchema=z.object({
 schemaVersion:z.literal('static-task-manifest-1'),taskVersion:z.literal('static-task-1'),generatorVersion:z.literal('static-generator-1'),solverVersion:z.literal('tiny-oracle-1'),
 simulationVersion:z.literal('poc-1'),demandVersion:z.literal('demand-1'),scorerVersion:z.literal('utility-1'),observationVersion:z.literal('observation-2'),
 terminalValuation:z.literal('utility-1-closing-settlement'),horizonEndTick:z.literal(120),taskTicks:z.tuple([z.literal(117),z.literal(118),z.literal(119)]),
 behaviorPolicies:z.tuple([z.literal('rules'),z.literal('mixed')]),defaultDevelopmentSeeds:z.tuple([z.literal(2000),z.literal(2001)]),
 developmentGeneratorSeeds:z.array(count),heldOutGeneratorSeeds:z.array(count),scenario:z.literal('clean'),selection:z.literal('all-task-ticks-in-seed-policy-order-before-labels'),
 categories:z.tuple([z.literal('serve-available'),z.literal('stockout-queue'),z.literal('no-queued-service')]),exactArithmetic:z.literal('rational'),includeAllOptimalActions:z.literal(true),maxStates:z.literal(20000),maxBranches:z.literal(20000),
 capRejections:z.literal('record-and-exclude-from-exact-labeled-split'),approximationLabels:z.literal('none'),heldOutGenerationRequiresExplicitOptIn:z.literal(true),deduplicateCanonicalStatesAcrossSplits:z.literal(true),researchCandidateTarget:z.literal('300-500-deferred'),
}).strict().refine(manifest=>canonicalState(manifest)===canonicalState(STATIC_TASK_MANIFEST),'Manifest differs from preregistered task family');
const LimitsSchema=z.object({maxStates:count.positive().max(STATIC_TASK_MANIFEST.maxStates),maxBranches:count.positive().max(STATIC_TASK_MANIFEST.maxBranches)}).strict();
export const StaticDatasetSchema=z.object({
 schemaVersion:z.literal('static-dataset-1'),manifest:ManifestSchema,manifestHash:hash,split:StaticSplitSchema,
 distribution: z.object({version:z.literal('static-task-1-independent-demand-1'),baseCount:z.array(z.object({numerator:z.string(),denominator:z.string()}).strict()).length(3),patienceEach:z.object({numerator:z.string(),denominator:z.string()}).strict(),promotionExtra:z.object({numerator:z.string(),denominator:z.string()}).strict(),rainKeep:z.object({numerator:z.string(),denominator:z.string()}).strict(),hiddenDraws:z.literal('independent finite-32-bit draw distributions; no realized seed schedule')}).strict(),
 generation:z.object({requestedSeeds:z.array(count).min(1),behaviorPolicies:z.array(BehaviorPolicySchema).min(1),generatedCount:count,duplicateRejections:z.array(duplicate),uniqueCandidateCount:count,excludedCanonicalStateHashes:z.array(hash)}).strict(),
 solverLimits:LimitsSchema,records:z.array(StaticLabeledTaskSchema),rejections:z.array(capRejection),
 counts:z.object({generated:count,duplicates:count,exactLabeled:count,oracleRejected:count}).strict(),datasetHash:hash,
}).strict().superRefine((dataset,ctx)=>{
 const issue=(message:string)=>ctx.addIssue({code:'custom',message});
 if(dataset.manifestHash!==staticManifestHash())issue('Manifest hash differs');
 if(canonicalState(dataset.distribution)!==canonicalState(ORACLE_DISTRIBUTION))issue('Oracle task distribution differs');
 const generation=dataset.generation;
 if(new Set(generation.requestedSeeds).size!==generation.requestedSeeds.length||new Set(generation.behaviorPolicies).size!==generation.behaviorPolicies.length)issue('Generator seeds/policies must be unique');
 const seedPool=dataset.split==='development'?dataset.manifest.developmentGeneratorSeeds:dataset.manifest.heldOutGeneratorSeeds;
 if(generation.requestedSeeds.some(seed=>!seedPool.includes(seed)))issue('Generation seeds cross declared split');
 if(generation.generatedCount!==generation.requestedSeeds.length*generation.behaviorPolicies.length*dataset.manifest.taskTicks.length)issue('Generated count differs from preregistered enumeration');
 if(generation.uniqueCandidateCount!==dataset.records.length+dataset.rejections.length||generation.generatedCount!==generation.uniqueCandidateCount+generation.duplicateRejections.length)issue('Generation rejection/label counts do not conserve candidates');
 if(dataset.counts.generated!==generation.generatedCount||dataset.counts.duplicates!==generation.duplicateRejections.length||dataset.counts.exactLabeled!==dataset.records.length||dataset.counts.oracleRejected!==dataset.rejections.length)issue('Dataset counts differ from actual records');
 if(dataset.records.some(r=>r.task.split!==dataset.split||!generation.requestedSeeds.includes(r.task.generator.seed)||!generation.behaviorPolicies.includes(r.task.generator.behaviorPolicy)))issue('Task provenance differs from generation manifest');
 const expectedIds=generation.requestedSeeds.flatMap(seed=>generation.behaviorPolicies.flatMap(policy=>dataset.manifest.taskTicks.map(tick=>`static-task-1-${dataset.split}-${seed}-${policy}-t${tick}`)));
 const actualIds=[...dataset.records.map(r=>r.task.taskId),...dataset.rejections.map(r=>r.taskId),...generation.duplicateRejections.map(r=>r.taskId)];
 if(actualIds.length!==expectedIds.length||new Set(actualIds).size!==actualIds.length||expectedIds.some(id=>!actualIds.includes(id)))issue('Every preregistered generator slot must be labeled or explicitly rejected once');
 const identities=[...dataset.records.map(r=>({taskId:r.task.taskId,canonicalStateHash:r.task.canonicalStateHash})),...dataset.rejections];
 if(new Set(identities.map(r=>r.taskId)).size!==identities.length||new Set(identities.map(r=>r.canonicalStateHash)).size!==identities.length)issue('Labeled/rejected tasks must be unique by ID and canonical state');
 if(identities.some(r=>generation.excludedCanonicalStateHashes.includes(r.canonicalStateHash)))issue('Cross-split excluded canonical state leaked into dataset');
 const knownHashes=new Set([...identities.map(r=>r.canonicalStateHash),...generation.excludedCanonicalStateHashes]);
 if(generation.duplicateRejections.some(r=>!knownHashes.has(r.canonicalStateHash)))issue('Duplicate rejection lacks a matching retained or excluded canonical state');
 if(dataset.records.some(r=>r.oracle.exploredStates>dataset.solverLimits.maxStates||r.oracle.exploredBranches>dataset.solverLimits.maxBranches))issue('Exact record exceeds declared oracle limits');
 if(dataset.rejections.some(r=>r.limitKind==='states'?r.exploredStates<=dataset.solverLimits.maxStates:r.exploredBranches<=dataset.solverLimits.maxBranches))issue('Oracle rejection lacks exceeded-limit evidence');
 if(dataset.datasetHash!==staticDatasetHash(dataset))issue('Dataset content hash differs');
});
export type StaticDataset=z.infer<typeof StaticDatasetSchema>;
export function staticManifestHash():string{return createHash('sha256').update('hawker-wars|static-task-1|manifest\n').update(canonicalState(STATIC_TASK_MANIFEST)).digest('hex');}
export function staticDatasetHash(dataset:unknown):string {
 if(!dataset||typeof dataset!=='object'||Array.isArray(dataset))throw new Error('Expected static dataset object');
 const {datasetHash:_ignored,...contents}=dataset as Record<string,unknown>;
 return createHash('sha256').update('hawker-wars|static-dataset-1\n').update(canonicalState(contents)).digest('hex');
}
/** Exact labels only; cap failures are explicit exclusions rather than approximate labels. */
export function evaluateDataset(generation:StaticCandidateGeneration,limits:Partial<OracleLimits>={}):StaticDataset {
 const solverLimits=LimitsSchema.parse({maxStates:STATIC_TASK_MANIFEST.maxStates,maxBranches:STATIC_TASK_MANIFEST.maxBranches,...limits});
 const records:StaticLabeledTask[]=[];const rejections:z.infer<typeof capRejection>[]=[];
 for(const raw of generation.candidates){
  const task=StaticTaskSchema.parse(raw);
  try {
   const oracle:ExactOracleResult=solveStaticTask({initialState:task.initialState,horizonEndTick:120,futureEvents:[]},solverLimits);
   records.push(StaticLabeledTaskSchema.parse({task,oracle}));
  } catch(error) {
   if(!(error instanceof OracleLimitError))throw error;
   rejections.push({taskId:task.taskId,canonicalStateHash:task.canonicalStateHash,reason:'oracle-limit',limitKind:error.limitKind,exploredStates:error.exploredStates,exploredBranches:error.exploredBranches});
  }
 }
 const contents={schemaVersion:'static-dataset-1' as const,manifest:STATIC_TASK_MANIFEST,manifestHash:staticManifestHash(),split:generation.split,distribution:ORACLE_DISTRIBUTION,
  generation:{requestedSeeds:generation.requestedSeeds,behaviorPolicies:generation.behaviorPolicies,generatedCount:generation.generatedCount,duplicateRejections:generation.duplicateRejections,uniqueCandidateCount:generation.candidates.length,excludedCanonicalStateHashes:generation.excludedCanonicalStateHashes},solverLimits,records,rejections,
  counts:{generated:generation.generatedCount,duplicates:generation.duplicateRejections.length,exactLabeled:records.length,oracleRejected:rejections.length}};
 return StaticDatasetSchema.parse({...contents,datasetHash:staticDatasetHash(contents)});
}
/** Stable frozen artifact; callers own file IO. Parsing verifies its manifest and content identities. */
export function freezeStaticDataset(dataset:StaticDataset):string {return JSON.stringify(StaticDatasetSchema.parse(dataset),null,2)+'\n';}
export function loadStaticDataset(text:string):StaticDataset {return StaticDatasetSchema.parse(JSON.parse(text) as unknown);}
export function assertDisjointStaticDatasets(left:StaticDataset,right:StaticDataset):void {
 const a=StaticDatasetSchema.parse(left),b=StaticDatasetSchema.parse(right);
 if(a.split===b.split)throw new Error('Expected different dataset splits');
 const identities=new Set([...a.records.map(r=>r.task.canonicalStateHash),...a.rejections.map(r=>r.canonicalStateHash)]);
 if([...b.records.map(r=>r.task.canonicalStateHash),...b.rejections.map(r=>r.canonicalStateHash)].some(id=>identities.has(id)))throw new Error('Canonical state overlap across dataset splits');
}
