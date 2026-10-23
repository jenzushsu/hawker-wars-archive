import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ActionSchema, ObservationSchema, SimulatorStateSchema, TRIAL_CONFIG, type Observation, type SimulatorState } from '../../shared/src/index.js';
import { createInitialFrame, prepareTick, applyAction, advanceTick } from '../../simulation/src/engine.js';
import { arrivalsAt, createDemandSchedule, toEngineArrival } from '../../simulation/src/demand.js';
import { getLegalActions } from '../../simulation/src/legality.js';
import { projectObservation } from '../../simulation/src/observation.js';
import { canonicalState } from '../../simulation/src/hash.js';
import { chooseRules } from '../../decisions/src/rules.js';

function freezeDeep<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(child=>freezeDeep(child));Object.freeze(value);}return value;}
export const STATIC_TASK_MANIFEST = freezeDeep({
  schemaVersion: 'static-task-manifest-1', taskVersion: 'static-task-1', generatorVersion: 'static-generator-1', solverVersion: 'tiny-oracle-1',
  simulationVersion: 'poc-1', demandVersion: 'demand-1', scorerVersion: 'utility-1', observationVersion: 'observation-2',
  terminalValuation: 'utility-1-closing-settlement', horizonEndTick: 120, taskTicks: [117,118,119] as const,
  behaviorPolicies: ['rules','mixed'] as const, defaultDevelopmentSeeds: [2000,2001] as const,
  developmentGeneratorSeeds: [...TRIAL_CONFIG.staticDevelopmentSeeds], heldOutGeneratorSeeds: [...TRIAL_CONFIG.staticHeldOutSeeds],
  scenario: 'clean', selection: 'all-task-ticks-in-seed-policy-order-before-labels',
  categories: ['serve-available','stockout-queue','no-queued-service'] as const,
  exactArithmetic: 'rational', includeAllOptimalActions: true, maxStates: 20000, maxBranches: 20000,
  capRejections: 'record-and-exclude-from-exact-labeled-split', approximationLabels: 'none',
  heldOutGenerationRequiresExplicitOptIn: true, deduplicateCanonicalStatesAcrossSplits: true,
  researchCandidateTarget: '300-500-deferred',
} as const);
export const StaticSplitSchema=z.enum(['development','held-out']);
export const BehaviorPolicySchema=z.enum(['rules','mixed']);
export type StaticSplit=z.infer<typeof StaticSplitSchema>;
export type BehaviorPolicy=z.infer<typeof BehaviorPolicySchema>;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const category=z.enum(STATIC_TASK_MANIFEST.categories);
export const StaticTaskSchema=z.object({
  taskId:z.string().regex(/^static-task-1-(development|held-out)-\d+-(rules|mixed)-t(117|118|119)$/),
  taskVersion:z.literal('static-task-1'),split:StaticSplitSchema,category,
  canonicalStateHash:hash,initialState:SimulatorStateSchema,observation:ObservationSchema,
  legalActions:z.array(ActionSchema).min(1),horizonEndTick:z.literal(120),futureEvents:z.array(z.never()).length(0),
  generator:z.object({version:z.literal('static-generator-1'),seed:z.number().int().safe(),behaviorPolicy:BehaviorPolicySchema,tick:z.union([z.literal(117),z.literal(118),z.literal(119)])}).strict(),
}).strict().superRefine((task,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(task.initialState.phase!=='decision'||task.initialState.tick!==task.generator.tick)issue('Static task must capture a prepared specified decision tick');
  if(!generatorSeeds(task.split).includes(task.generator.seed))issue('Generator seed belongs to a different frozen split');
  try {
    if(task.canonicalStateHash!==canonicalStaticStateHash(task.initialState))issue('Canonical state identity differs');
    if(JSON.stringify(task.legalActions)!==JSON.stringify(getLegalActions(task.initialState)))issue('Legal actions differ from captured state');
    if(canonicalState(task.observation)!==canonicalState(projectObservation(task.initialState,task.observation.recentActions)))issue('Observation differs from allowlisted projection');
  } catch { issue('Static task state cannot form a valid prepared provider projection'); }
  if(task.category!==classifyTask(task.initialState))issue('Category differs from pre-label state classification');
  if(task.taskId!==taskId(task.split,task.generator.seed,task.generator.behaviorPolicy,task.generator.tick))issue('Task identity differs from provenance');
});
export type StaticTask=z.infer<typeof StaticTaskSchema>;
function generatorSeeds(split:StaticSplit): readonly number[] {return split==='development'?TRIAL_CONFIG.staticDevelopmentSeeds:TRIAL_CONFIG.staticHeldOutSeeds;}
function taskId(split:StaticSplit,seed:number,policy:BehaviorPolicy,tick:number){return `static-task-1-${split}-${seed}-${policy}-t${tick}`;}
/** Cosmetic ID normalization preserves queue order and expiry order without evaluator metadata. */
export function canonicalStaticState(state:SimulatorState):SimulatorState {
  const copy=SimulatorStateSchema.parse(structuredClone(state));
  copy.readyBatches=copy.readyBatches.map((batch,index)=>({...batch,id:`batch-${index}`}));
  const ordinals=new Map<number,number>();
  copy.queue=copy.queue.map(customer=>{
    const ordinal=ordinals.get(customer.arrivalTick)??0;ordinals.set(customer.arrivalTick,ordinal+1);
    return {...customer,id:`customer-${customer.arrivalTick}-base-${ordinal}`};
  });
  return SimulatorStateSchema.parse(copy);
}
export function canonicalStaticStateHash(state:SimulatorState):string {
  return createHash('sha256').update('hawker-wars|static-task-1|canonical-state\n').update(canonicalState(canonicalStaticState(state))).digest('hex');
}
function classifyTask(state:SimulatorState):z.infer<typeof category> {
  const ready=state.readyBatches.reduce((n,b)=>n+b.quantity,0);
  return state.queue.length>0?(ready>0?'serve-available':'stockout-queue'):'no-queued-service';
}
function chooseBehavior(state:SimulatorState,policy:BehaviorPolicy,seed:number){
  const legal=getLegalActions(state);
  if(policy==='rules')return chooseRules(state,legal).action;
  const draw=createHash('sha256').update(`hawker-wars|static-generator-1|mixed|${seed}|${state.tick}`).digest().readUInt32BE(0);
  return legal[draw%legal.length]!;
}
export interface StaticGenerationOptions {split?:StaticSplit;seeds?:readonly number[];behaviorPolicies?:readonly BehaviorPolicy[];enableHeldOut?:boolean;excludeCanonicalStateHashes?:readonly string[]}
export interface StaticCandidateGeneration {
  schemaVersion:'static-candidate-generation-1';split:StaticSplit;generatorVersion:'static-generator-1';
  requestedSeeds:number[];behaviorPolicies:BehaviorPolicy[];generatedCount:number;candidates:StaticTask[];
  duplicateRejections:{taskId:string;canonicalStateHash:string;reason:'duplicate-canonical-state'}[];excludedCanonicalStateHashes:string[];
}
/** Enumerate reachable prefix states; selection never consults solver/provider results. */
export function generateStaticCandidates(options:StaticGenerationOptions={}):StaticCandidateGeneration {
  const split=StaticSplitSchema.parse(options.split??'development');
  if(split==='held-out'&&options.enableHeldOut!==true)throw new Error('Held-out generation requires explicit enableHeldOut opt-in');
  const seeds=[...(options.seeds??(split==='development'?STATIC_TASK_MANIFEST.defaultDevelopmentSeeds:[]))];
  const policies=[...(options.behaviorPolicies??STATIC_TASK_MANIFEST.behaviorPolicies)].map(p=>BehaviorPolicySchema.parse(p));
  if(seeds.length===0||new Set(seeds).size!==seeds.length||seeds.some(seed=>!generatorSeeds(split).includes(seed)))throw new Error('Seeds must be unique members of the declared static generator split');
  if(policies.length===0||new Set(policies).size!==policies.length)throw new Error('Behavior policies must be unique and nonempty');
  const seen=new Set(options.excludeCanonicalStateHashes??[]);
  if([...seen].some(value=>!hash.safeParse(value).success))throw new Error('Excluded canonical hashes must be valid identities');
  const candidates:StaticTask[]=[];const duplicateRejections:StaticCandidateGeneration['duplicateRejections']=[];let generatedCount=0;
  for(const seed of seeds)for(const policy of policies){
    const schedule=createDemandSchedule(seed,'clean');let frame=createInitialFrame();const recent:Observation['recentActions']=[];
    for(let tick=0;tick<120;tick++){
      const promotion=frame.state.promotion;
      const active=promotion!==null&&promotion.startsAt<=tick&&promotion.endsAt>=tick;
      frame=prepareTick(frame,{arrivals:arrivalsAt(schedule,tick,active).map(toEngineArrival)});
      if((STATIC_TASK_MANIFEST.taskTicks as readonly number[]).includes(tick)){
        const initialState=canonicalStaticState(frame.state);const canonicalStateHash=canonicalStaticStateHash(initialState);generatedCount++;
        const id=taskId(split,seed,policy,tick);
        if(seen.has(canonicalStateHash))duplicateRejections.push({taskId:id,canonicalStateHash,reason:'duplicate-canonical-state'});
        else {seen.add(canonicalStateHash);candidates.push(StaticTaskSchema.parse({taskId:id,taskVersion:'static-task-1',split,category:classifyTask(initialState),canonicalStateHash,initialState,observation:projectObservation(initialState,recent.slice(-5)),legalActions:getLegalActions(initialState),horizonEndTick:120,futureEvents:[],generator:{version:'static-generator-1',seed,behaviorPolicy:policy,tick}}));}
      }
      const action=chooseBehavior(frame.state,policy,seed);frame=applyAction(frame,action);recent.push({tick,action});frame=advanceTick(frame);
    }
  }
  return {schemaVersion:'static-candidate-generation-1',split,generatorVersion:'static-generator-1',requestedSeeds:seeds,behaviorPolicies:policies,generatedCount,candidates,duplicateRejections,excludedCanonicalStateHashes:[...(options.excludeCanonicalStateHashes??[])]};
}
