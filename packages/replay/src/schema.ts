import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ActionSchema, ActionSummarySchema, ContractVersionsSchema, CustomerSchema, DecisionInputSchema,
  DecisionResultSchema, FixtureStateSchema, HashSchema, IdentifierSchema, NonnegativeIntegerSchema,
  ObservationSchema,
} from '../../shared/src/index.js';
import { assertFrame, createInitialFrame } from '../../simulation/src/engine.js';
import { scoreState, episodeMetrics } from '../../simulation/src/scoring.js';
import { stateHash } from '../../simulation/src/hash.js';
import type { EngineFrame } from '../../simulation/src/types.js';

/** Archive identity permits finite metric ratios; simulator identity remains integer-only state-hash-1. */
export function canonicalArchive(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalArchive).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record=value as Record<string,unknown>;
    return `{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${canonicalArchive(record[key])}`).join(',')}}`;
  }
  throw new Error('Archive contains unsupported JSON data');
}
export const archiveDigest=(value:unknown):string=>createHash('sha256').update('hawker-wars|episode-archive-1\n').update(canonicalArchive(value)).digest('hex');
const count=NonnegativeIntegerSchema;
const bounded=(max:number)=>count.refine(n=>n<=max,`Must be at most ${max}`);
const finite=z.number().finite().refine(n=>!Object.is(n,-0),'Negative zero is not canonical');
const ratio=finite.refine(n=>n>=0,'Negative metric');
const signedInteger=z.number().int().safe().refine(n=>!Object.is(n,-0),'Negative zero is not canonical');
export const ResolutionSchema=z.object({
  type:z.literal('customer-resolved'),tick:bounded(120),customerId:IdentifierSchema,arrivalTick:bounded(119),waitMinutes:bounded(120),
  outcome:z.enum(['served','queue_full','patience_expired','closing_unserved']),
}).strict().superRefine((r,ctx)=>{
  if(r.tick-r.arrivalTick!==r.waitMinutes)ctx.addIssue({code:'custom',message:'Resolution wait mismatch'});
  if(r.outcome==='queue_full'&&r.waitMinutes!==0)ctx.addIssue({code:'custom',message:'Rejected arrival cannot wait'});
  if(r.outcome==='closing_unserved'&&r.tick!==120)ctx.addIssue({code:'custom',message:'Closing resolution requires terminal tick'});
});
export const EventSchema=z.union([
  ResolutionSchema,
  z.object({type:z.literal('ready-wasted'),tick:bounded(120),quantity:count.refine(n=>n>0),reason:z.enum(['expiry','closing'])}).strict(),
  z.object({type:z.literal('cooking-completed'),tick:bounded(119),quantity:z.literal(10),batchId:IdentifierSchema}).strict(),
  z.object({type:z.literal('restock-delivered'),tick:bounded(119),quantity:z.literal(20)}).strict(),
  z.object({type:z.literal('action-applied'),tick:bounded(119),action:ActionSchema}).strict(),
  z.object({type:z.literal('effect-applied'),tick:bounded(119),eventId:IdentifierSchema,effectType:z.enum(['bus','rain','supplier-delay'])}).strict(),
  z.object({type:z.literal('closed'),tick:z.literal(120)}).strict(),
]);
export const ExternalEventSchema=z.object({id:IdentifierSchema,type:z.enum(['bus','rain','supplier-delay']),effectiveTick:bounded(119),endsAt:bounded(128).optional()}).strict().superRefine((e,ctx)=>{
  if(e.endsAt!==undefined&&e.endsAt!==e.effectiveTick+(e.type==='bus'?0:9))ctx.addIssue({code:'custom',message:'Event duration mismatch'});
});
export const FrameSchema=z.object({
  stage:z.enum(['before-tick','decision','committed','closed']),boundaryTick:bounded(120),state:FixtureStateSchema,
  ledger:z.object({openingCashCents:z.literal(20000),openingPortions:z.literal(42)}).strict(),
  appliedEvents:z.array(ExternalEventSchema).max(1),seenCustomerIds:z.array(IdentifierSchema).max(1080),events:z.array(EventSchema).max(100),
}).strict().transform((frame):EngineFrame=>({
  ...frame,appliedEvents:frame.appliedEvents.map(({endsAt,...event})=>endsAt===undefined?event:{...event,endsAt}),
})).superRefine((frame,ctx)=>{try{assertFrame(frame);}catch(e){ctx.addIssue({code:'custom',message:e instanceof Error?e.message:'Invalid frame'});}});
const potential=z.object({
  id:IdentifierSchema,publicId:z.string().regex(/^customer-\d+-(base|bus|promotion)-\d+$/),arrivalTick:bounded(119),
  patience:count.refine(n=>n>=3&&n<=10),deadlineTick:bounded(129),source:z.enum(['base','bus','promotion']),ordinal:bounded(8),slotIndex:bounded(8),rainKeep:z.boolean(),
}).strict();
const shock=z.object({id:IdentifierSchema,type:z.enum(['bus','rain','supplier-delay']),effectiveTick:bounded(119),endsAt:bounded(128)}).strict();
/** Validates stored schedule contents and hash without drawing or regenerating any seed. */
export const StoredScheduleSchema=z.object({
  version:z.literal('demand-1'),seed:count,scenario:z.enum(['clean','bus','rain','supplier-delay']),shock:shock.nullable(),
  ticks:z.array(z.array(potential).max(9)).length(120),privateToPublicIds:z.record(IdentifierSchema,IdentifierSchema),hash:HashSchema,
}).strict().superRefine((s,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(s.scenario==='clean'?s.shock!==null:s.shock===null||s.shock.type!==s.scenario)issue('Scenario shock mismatch');
  if(s.shock&&s.shock.endsAt!==s.shock.effectiveTick+(s.shock.type==='bus'?0:9))issue('Shock interval mismatch');
  const flat=s.ticks.flat(),seen=new Set<string>(),map:Record<string,string>={};
  for(const [tick,arrivals]of s.ticks.entries()){
    const counts={base:arrivals.filter(a=>a.source==='base').length,bus:arrivals.filter(a=>a.source==='bus').length,promotion:arrivals.filter(a=>a.source==='promotion').length};
    if(counts.base>2||(tick>=30&&tick<=89&&counts.base<1)||counts.promotion>1||counts.bus!==(s.shock?.type==='bus'&&s.shock.effectiveTick===tick?6:0))issue('Stored potential counts violate demand-1');
    for(const source of ['base','bus','promotion']as const){if(arrivals.filter(a=>a.source===source).some((a,ordinal)=>a.ordinal!==ordinal))issue('Source ordinals must be consecutive');}
    let previousSource=-1;
    for(const [slot,a]of arrivals.entries()){
      const sourceIndex=['base','bus','promotion'].indexOf(a.source);
      if(a.arrivalTick!==tick||a.deadlineTick!==tick+a.patience||a.slotIndex!==slot||sourceIndex<previousSource)issue('Stored arrival boundary/order mismatch');
      previousSource=sourceIndex;
      if(a.source!=='base'&&!a.rainKeep)issue('Only base arrivals can be filtered by rain');
      if(a.publicId!==`customer-${tick}-${a.source}-${a.ordinal}`||a.id!==`seed-${s.seed}:${a.publicId}`)issue('Stored arrival identity mismatch');
      if(seen.has(a.id))issue('Duplicate stored arrival');seen.add(a.id);map[a.id]=a.publicId;
    }
  }
  if(flat.length!==Object.keys(s.privateToPublicIds).length||canonicalArchive(map)!==canonicalArchive(s.privateToPublicIds))issue('Private identity mapping mismatch');
  const {hash,...contents}=s;
  const computed=createHash('sha256').update('hawker-wars|demand-1|schedule\n').update(canonicalArchive(contents)).digest('hex');
  if(computed!==hash)issue('Stored schedule checksum mismatch');
});
const provider=z.enum(['jev','zoom','zoom-pro']);
const fallbackReason=z.enum(['invalid','illegal','network','rate-limit','timeout','uncertain','budget','quota']);
export const TurnOutcomeSchema=z.object({
  mode:z.literal('offline'),origin:z.enum(['rules','mock','fallback','forced_wait']),attemptedProvider:z.union([provider,z.literal('rules'),z.null()]),
  proposedAction:ActionSchema.nullable(),appliedAction:ActionSchema,providerStatus:z.enum(['success','error','not-called']),applicationStatus:z.enum(['success','fallback','forced_wait']),appliedPolicy:z.union([provider,z.enum(['rules','forced_wait'])]),
  baselineVersion:z.literal('rules-1'),failurePolicyVersion:z.literal('fallback-2'),rulePriority:count.refine(n=>n>=1&&n<=8).nullable(),latencyMs:count,attemptCount:z.union([z.literal(0),z.literal(1)]),
  fallbackReason:fallbackReason.nullable(),diagnostic:z.string().min(1).max(1000).nullable(),appliedResult:DecisionResultSchema.nullable(),
}).strict().superRefine((o,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(o.origin==='forced_wait'){
    if(o.attemptedProvider!==null||o.proposedAction!==null||o.appliedAction!=='WAIT'||o.providerStatus!=='not-called'||o.applicationStatus!=='forced_wait'||o.appliedPolicy!=='forced_wait'||o.rulePriority!==null||o.latencyMs!==0||o.attemptCount!==0||o.fallbackReason!==null||o.diagnostic!==null||o.appliedResult!==null)issue('Invalid forced WAIT attribution');
  }else if(o.origin==='rules'){
    if(o.attemptedProvider!=='rules'||o.appliedPolicy!=='rules'||o.applicationStatus!=='success'||o.providerStatus!=='success'||o.rulePriority===null||o.latencyMs!==0||o.attemptCount!==0||o.fallbackReason!==null||o.proposedAction!==o.appliedAction||o.appliedResult?.provider!=='rules'||o.appliedResult.status!=='success'||o.appliedResult.action!==o.appliedAction)issue('Invalid rules attribution');
  }else{
    if(!provider.safeParse(o.attemptedProvider).success||o.attemptCount!==1||!o.appliedResult||o.appliedResult.provider!==o.attemptedProvider||o.appliedResult.latencyMs!==o.latencyMs)issue('Invalid mock/fallback provider attribution');
    if(o.origin==='mock'&&(o.applicationStatus!=='success'||o.providerStatus!=='success'||o.appliedPolicy!==o.attemptedProvider||o.rulePriority!==null||o.fallbackReason!==null||o.proposedAction!==o.appliedAction||o.appliedResult?.status!=='success'||o.appliedResult.action!==o.appliedAction))issue('Invalid mock success');
    if(o.origin==='fallback'&&(o.applicationStatus!=='fallback'||o.providerStatus!=='error'||o.appliedPolicy!=='rules'||o.rulePriority===null||o.fallbackReason===null||o.appliedResult?.status!=='fallback'||o.appliedResult.appliedAction!==o.appliedAction||o.appliedResult.action!==o.proposedAction||o.appliedResult.fallbackReason!==o.fallbackReason))issue('Invalid fallback attribution');
  }
});
export const SourceIdentitySchema=z.object({method:z.string().min(1).max(100),sourceTreeHash:HashSchema,dependencyLockHash:HashSchema,files:z.array(z.object({path:z.string().min(1).max(500).refine(p=>!p.startsWith('/')&&!p.split('/').includes('..')),sha256:HashSchema}).strict()).min(1).max(10000)}).strict().superRefine((s,ctx)=>{
  if(new Set(s.files.map(f=>f.path)).size!==s.files.length)ctx.addIssue({code:'custom',message:'Duplicate source identity file'});
});
export const EpisodeHeaderSchema=z.object({
  contracts:ContractVersionsSchema,configurationHash:HashSchema,schedule:StoredScheduleSchema,policy:z.enum(['rules','mixed']),runId:z.string().uuid(),sourceIdentity:SourceIdentitySchema,initialFrame:FrameSchema,
}).strict().superRefine((h,ctx)=>{
  if(canonicalArchive(h.initialFrame)!==canonicalArchive(createInitialFrame()))ctx.addIssue({code:'custom',message:'Archive must start at the exact standard initial boundary'});
});
export const EpisodeTurnSchema=z.object({
  sequence:count.refine(n=>n>=1&&n<=120),tick:bounded(119),input:DecisionInputSchema,observation:ObservationSchema,decision:TurnOutcomeSchema,
  appliedAction:ActionSchema,preparedHash:HashSchema,committedHash:HashSchema,preparedEvents:z.array(EventSchema).max(100),committedEvents:z.array(EventSchema).max(100),
}).strict().superRefine((t,ctx)=>{
  if(t.sequence!==t.tick+1||t.input.tick!==t.tick||canonicalArchive(t.input.observation)!==canonicalArchive(t.observation)||t.appliedAction!==t.decision.appliedAction||!t.input.legalActions.includes(t.appliedAction))ctx.addIssue({code:'custom',message:'Turn boundary/action mismatch'});
  if(t.decision.origin==='forced_wait'&&(t.input.legalActions.length!==1||t.input.legalActions[0]!=='WAIT'))ctx.addIssue({code:'custom',message:'Forced WAIT requires sole legal WAIT'});
  if([...t.preparedEvents,...t.committedEvents].some(e=>e.tick!==t.tick))ctx.addIssue({code:'custom',message:'Turn events belong to another tick'});
});
export const ScoreSchema=z.object({profitCents:signedInteger,utilityPoints:signedInteger,meanWaitMinutes:ratio.nullable(),satisfaction:ratio.refine(n=>n<=100).nullable(),provisional:z.boolean()}).strict();
export const MetricsSchema=ScoreSchema.extend({served:count,abandoned:count,wasted:count,waitMinutes:count,servedMeanWaitMinutes:ratio.nullable(),fillRate:ratio.refine(n=>n<=1).nullable(),stockoutTicks:bounded(120)}).strict();
export const EpisodeTerminalSchema=z.object({
  sequence:z.literal(121),frame:FrameSchema,recentActions:z.array(ActionSummarySchema).max(5),resolutions:z.array(ResolutionSchema).max(1080),stockoutTicks:bounded(120),score:ScoreSchema,metrics:MetricsSchema,finalHash:HashSchema,traceHash:HashSchema,events:z.array(EventSchema).max(100),
}).strict().superRefine((t,ctx)=>{
  if(t.frame.stage!=='closed'||t.frame.boundaryTick!==120||t.score.provisional||t.metrics.provisional||t.events.some(e=>e.tick!==120))ctx.addIssue({code:'custom',message:'Invalid terminal boundary'});
  try{
    if(canonicalArchive(scoreState(t.frame.state,t.resolutions))!==canonicalArchive(t.score)||canonicalArchive(episodeMetrics(t.frame.state,t.resolutions,t.stockoutTicks))!==canonicalArchive(t.metrics))ctx.addIssue({code:'custom',message:'Terminal score/metric projection mismatch'});
  }catch(e){ctx.addIssue({code:'custom',message:e instanceof Error?e.message:'Invalid terminal resolutions'});}
  if(canonicalArchive(t.frame.events)!==canonicalArchive(t.events))ctx.addIssue({code:'custom',message:'Terminal events mismatch'});
});
export const PrivateSnapshotSchema=z.object({
  schemaVersion:z.literal('private-snapshot-1'),sequence:bounded(120),frame:FrameSchema,recentActions:z.array(ActionSummarySchema).max(5),resolutions:z.array(ResolutionSchema).max(1080),stockoutTicks:bounded(120),stateHash:HashSchema,
}).strict().superRefine((s,ctx)=>{
  if(s.sequence===0?(s.frame.stage!=='before-tick'||s.frame.boundaryTick!==0):(s.frame.stage!=='committed'||s.frame.boundaryTick!==s.sequence-1))ctx.addIssue({code:'custom',message:'Snapshot is not at its committed sequence boundary'});
  if(s.recentActions.some((a,i)=>a.tick>=s.sequence||(i>0&&a.tick<=s.recentActions[i-1]!.tick)))ctx.addIssue({code:'custom',message:'Invalid snapshot history'});
  if(s.stockoutTicks>s.sequence)ctx.addIssue({code:'custom',message:'Stockout count exceeds observed turns'});
  try{scoreState(s.frame.state,s.resolutions);}catch(e){ctx.addIssue({code:'custom',message:e instanceof Error?e.message:'Invalid snapshot resolutions'});}
});
export const PublicSnapshotSchema=z.object({
  schemaVersion:z.literal('public-snapshot-1'),sequence:bounded(120),tick:bounded(119),phase:z.enum(['committed','waiting']),
  cashCents:count,rawPortions:bounded(60),readyPortions:bounded(30),queueLength:bounded(30),served:count,abandoned:count,wasted:count,profitCents:signedInteger,utilityPoints:signedInteger,
}).strict();
export const EpisodeArchiveSchema=z.object({
  schemaVersion:z.literal('episode-archive-1'),header:EpisodeHeaderSchema,turns:z.array(EpisodeTurnSchema).length(120),terminal:EpisodeTerminalSchema,snapshots:z.array(PrivateSnapshotSchema).max(121),
}).strict().superRefine((a,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(a.turns.some((t,i)=>t.sequence!==i+1||t.tick!==i||t.input.roundId!==a.header.runId))issue('Archive turn sequence/run mismatch');
  const snapshotSequences=a.snapshots.map(s=>s.sequence);
  if(snapshotSequences.some((seq,i)=>i>0&&seq<=snapshotSequences[i-1]!))issue('Snapshot sequence must strictly increase');
  const resolutionsThrough=(sequence:number)=>a.turns.slice(0,sequence).flatMap(t=>[...t.preparedEvents,...t.committedEvents]).filter(e=>e.type==='customer-resolved');
  for(const snapshot of a.snapshots){
    const history=a.turns.slice(0,snapshot.sequence).slice(-5).map(t=>({tick:t.tick,action:t.appliedAction}));
    if(canonicalArchive(snapshot.recentActions)!==canonicalArchive(history)||canonicalArchive(snapshot.resolutions)!==canonicalArchive(resolutionsThrough(snapshot.sequence)))issue('Snapshot committed history/resolutions mismatch');
    const computed=stateHash({frame:snapshot.frame,scheduleHash:a.header.schedule.hash,scenario:a.header.schedule.scenario,configurationHash:a.header.configurationHash,recentActions:snapshot.recentActions});
    if(computed!==snapshot.stateHash||(snapshot.sequence>0&&a.turns[snapshot.sequence-1]?.committedHash!==snapshot.stateHash))issue('Snapshot state checksum mismatch');
  }
  if(canonicalArchive(a.terminal.recentActions)!==canonicalArchive(a.turns.slice(-5).map(t=>({tick:t.tick,action:t.appliedAction}))))issue('Terminal committed action history mismatch');
  if(canonicalArchive(a.terminal.resolutions)!==canonicalArchive([...resolutionsThrough(120),...a.terminal.events.filter(e=>e.type==='customer-resolved')]))issue('Terminal resolution history mismatch');
  const terminalHash=stateHash({frame:a.terminal.frame,scheduleHash:a.header.schedule.hash,scenario:a.header.schedule.scenario,configurationHash:a.header.configurationHash,recentActions:a.terminal.recentActions});
  if(terminalHash!==a.terminal.finalHash)issue('Terminal state checksum mismatch');
});
export type EpisodeHeader=z.infer<typeof EpisodeHeaderSchema>;
export type EpisodeTurn=z.infer<typeof EpisodeTurnSchema>;
export type EpisodeTerminal=z.infer<typeof EpisodeTerminalSchema>;
export type PrivateSnapshot=z.infer<typeof PrivateSnapshotSchema>;
export type PublicSnapshot=z.infer<typeof PublicSnapshotSchema>;
export type EpisodeArchive=z.infer<typeof EpisodeArchiveSchema>;
export function parseArchive(value:unknown,expectedConfigurationHash?:string):EpisodeArchive {
  const archive=EpisodeArchiveSchema.parse(value);
  if(expectedConfigurationHash!==undefined&&archive.header.configurationHash!==HashSchema.parse(expectedConfigurationHash))throw new Error('Archive configuration hash mismatch');
  return archive;
}
