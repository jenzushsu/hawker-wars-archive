import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ActionSchema, ContractVersionsSchema, CONTRACT_VERSIONS, HashSchema, LegalActionsSchema,
  NonnegativeIntegerSchema, ObservationSchema, SafeIntegerSchema, SimulatorStateSchema,
  type SimulatorState, type Observation,
} from '../../shared/src/index.js';
import { episodeMetrics, type Resolution } from '../../simulation/src/scoring.js';
import { StaticDatasetSchema, StaticLabeledTaskSchema, type StaticDataset } from './static-dataset.js';

const integer=NonnegativeIntegerSchema;
const nullableMean=z.number().finite().nonnegative().nullable();
const policy=z.enum(['rules','mixed']);
const scenario=z.enum(['clean','bus','rain','supplier-delay']);
const mode=z.enum(['offline','replay']);
const publicCustomerId=z.string().regex(/^customer-(?:0|[1-9]\d{0,2})-(?:base|bus|promotion)-(?:0|[1-9]\d?)$/);
const fallbackReason=z.enum(['invalid','illegal','network','rate-limit','timeout','uncertain','budget','quota']).nullable();
const provider=z.enum(['jev','zoom','zoom-pro','rules']);
const provenance=z.object({sourceRevision:z.string().regex(/^[a-f0-9]{40}$/).nullable(),sourceTreeHash:HashSchema,dependencyLockHash:HashSchema}).strict();
const hashes=z.object({configurationHash:HashSchema,scheduleHash:HashSchema,finalHash:HashSchema,traceHash:HashSchema}).strict();
const units=z.object({gameCurrency:z.literal('SGD'),profit:z.literal('cents'),utility:z.literal('points'),wait:z.literal('game-minutes'),satisfaction:z.literal('0-100')}).strict();
const publicResolution=z.object({customerId:publicCustomerId,arrivalTick:integer,tick:integer,waitMinutes:integer,outcome:z.enum(['served','queue_full','patience_expired','closing_unserved'])}).strict().refine(r=>Number(r.customerId.split('-')[1])===r.arrivalTick,'Public customer ID must match arrival tick');
const metrics=z.object({profitCents:SafeIntegerSchema,utilityPoints:SafeIntegerSchema,meanWaitMinutes:nullableMean,satisfaction:z.number().finite().min(0).max(100).nullable(),provisional:z.literal(false),served:integer,abandoned:integer,wasted:integer,waitMinutes:integer,servedMeanWaitMinutes:nullableMean,fillRate:z.number().finite().min(0).max(1).nullable(),stockoutTicks:integer}).strict();
const summary=z.object({turns:z.literal(120),rules:integer,mock:integer,fallback:integer,forcedWait:integer,attemptedRequests:integer,networkCalls:z.literal(0)}).strict().superRefine((s,ctx)=>{
  if(s.rules+s.mock+s.fallback+s.forcedWait!==120||s.attemptedRequests!==s.mock+s.fallback)ctx.addIssue({code:'custom',message:'Decision summary counts disagree'});
});
const reportSchema=z.object({schemaVersion:z.literal('episode-report-1'),episodeId:z.string().uuid(),mode,policy,scenario,classification:z.literal('offline-development'),contracts:ContractVersionsSchema,hashes,sourceProvenance:provenance,units,finalState:SimulatorStateSchema,resolutions:z.array(publicResolution),metrics,decisionSummary:summary}).strict();
export type EpisodeReport=z.infer<typeof reportSchema>;
export type ExportSourceProvenance=z.infer<typeof provenance>;
export interface ExportTurnInput {
  tick:number;
  observation:Observation;
  decision:{origin:'rules'|'mock'|'fallback'|'forced_wait';attemptedProvider:'jev'|'zoom'|'zoom-pro'|'rules'|null;proposedAction:z.infer<typeof ActionSchema>|null;appliedAction:z.infer<typeof ActionSchema>;providerStatus:'success'|'error'|'not-called';applicationStatus:'success'|'fallback'|'forced_wait';appliedPolicy:'jev'|'zoom'|'zoom-pro'|'rules'|'forced_wait';baselineVersion:'rules-1';failurePolicyVersion:'fallback-2';rulePriority:number|null;latencyMs:number;attemptCount:0|1;fallbackReason:z.infer<typeof fallbackReason>};
}
export interface EpisodeExportInput {
  episodeId:string;mode:'offline'|'replay';policy:'rules'|'mixed';scenario:z.infer<typeof scenario>;
  configurationHash:string;scheduleHash:string;finalHash:string;traceHash:string;sourceProvenance:ExportSourceProvenance;
  finalState:SimulatorState;resolutions:readonly Resolution[];stockoutTicks:number;trace:readonly ExportTurnInput[];
}
const publicDecision=z.object({recordType:z.literal('decision'),decisionId:z.string(),episodeId:z.string().uuid(),tick:integer,observation:ObservationSchema,legalActions:LegalActionsSchema,origin:z.enum(['rules','mock','fallback','forced_wait']),attemptedProvider:provider.nullable(),proposedAction:ActionSchema.nullable(),appliedAction:ActionSchema,providerStatus:z.enum(['success','error','not-called']),applicationStatus:z.enum(['success','fallback','forced_wait']),appliedPolicy:z.enum(['jev','zoom','zoom-pro','rules','forced_wait']),baselineVersion:z.literal('rules-1'),failurePolicyVersion:z.literal('fallback-2'),rulePriority:integer.nullable(),latencyMs:integer,attemptCount:z.union([z.literal(0),z.literal(1)]),fallbackReason}).strict().superRefine((d,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:'custom',message});
  if(d.tick>119||d.tick!==d.observation.tick||d.decisionId!==`${d.episodeId}:${d.tick}`)issue('Decision ID/tick mismatch');
  if(JSON.stringify(d.legalActions)!==JSON.stringify(d.observation.legalActions)||!d.legalActions.includes(d.appliedAction))issue('Decision differs from captured legal actions');
  if(d.origin==='forced_wait'){
    if(d.legalActions.length!==1||d.appliedAction!=='WAIT'||d.attemptCount!==0||d.attemptedProvider!==null||d.proposedAction!==null||d.providerStatus!=='not-called'||d.applicationStatus!=='forced_wait'||d.appliedPolicy!=='forced_wait'||d.fallbackReason!==null||d.rulePriority!==null||d.latencyMs!==0)issue('Invalid forced WAIT attribution');
  }else{
    if(d.legalActions.length===1)issue('A forced WAIT cannot be attributed as a controller call');
    if(d.origin==='rules'&&(d.attemptedProvider!=='rules'||d.appliedPolicy!=='rules'||d.attemptCount!==0||d.applicationStatus!=='success'||d.providerStatus!=='success'||d.proposedAction!==d.appliedAction||d.fallbackReason!==null||d.rulePriority===null||d.rulePriority<1||d.rulePriority>8))issue('Invalid rules attribution');
    if(d.origin==='mock'&&(d.attemptedProvider===null||d.attemptedProvider==='rules'||d.appliedPolicy!==d.attemptedProvider||d.attemptCount!==1||d.providerStatus!=='success'||d.applicationStatus!=='success'||d.proposedAction!==d.appliedAction||d.fallbackReason!==null||d.rulePriority!==null))issue('Invalid mock attribution');
    if(d.origin==='fallback'&&(d.attemptedProvider===null||d.attemptedProvider==='rules'||d.appliedPolicy!=='rules'||d.attemptCount!==1||d.providerStatus!=='error'||d.applicationStatus!=='fallback'||d.fallbackReason===null||d.rulePriority===null||d.rulePriority<1||d.rulePriority>8))issue('Invalid fallback attribution');
  }
});
export type PublicDecisionRecord=z.infer<typeof publicDecision>;

/** Canonical export JSON permits finite metric fractions; simulator hashing remains integer-only. */
function canonical(value:unknown):string {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
  throw new Error('Export contains noncanonical JSON data');
}
const digest=(records:readonly unknown[],domain='public-episode-jsonl-1')=>createHash('sha256').update(`hawker-wars|${domain}\n`).update(records.map(canonical).join('\n')).digest('hex');
function publicId(id:string):string {
  const match=/(?:^|\|)(customer-(?:0|[1-9]\d{0,2})-(?:base|bus|promotion)-(?:0|[1-9]\d?))$/.exec(id);
  if(!match)throw new Error('Customer ID has no safe public mapping');
  return match[1]!;
}
function parseReport(value:unknown):EpisodeReport {
  const r=reportSchema.parse(value);
  if(r.finalState.phase!=='closed'||r.finalState.tick!==120)throw new Error('Only completed episode reports may be exported');
  const recomputed=episodeMetrics(r.finalState,r.resolutions,r.metrics.stockoutTicks);
  if(canonical(recomputed)!==canonical(r.metrics))throw new Error('Saved metrics disagree with recomputed episode score');
  if(r.policy==='rules'&&(r.decisionSummary.mock!==0||r.decisionSummary.fallback!==0))throw new Error('Rules-only report contains provider-attributed turns');
  if(r.policy==='mixed'&&r.decisionSummary.rules!==0)throw new Error('Mixed mock report contains rules-only turns');
  return r;
}
function decisions(input:EpisodeExportInput):PublicDecisionRecord[]{
  if(input.trace.length!==120)throw new Error('Export requires all 120 decision boundaries');
  const rows=input.trace.map((turn,index)=>{
    const d=turn.decision;
    const row=publicDecision.parse({recordType:'decision',decisionId:`${input.episodeId}:${turn.tick}`,episodeId:input.episodeId,tick:turn.tick,observation:turn.observation,legalActions:turn.observation.legalActions,origin:d.origin,attemptedProvider:d.attemptedProvider,proposedAction:d.proposedAction,appliedAction:d.appliedAction,providerStatus:d.providerStatus,applicationStatus:d.applicationStatus,appliedPolicy:d.appliedPolicy,baselineVersion:d.baselineVersion,failurePolicyVersion:d.failurePolicyVersion,rulePriority:d.rulePriority,latencyMs:d.latencyMs,attemptCount:d.attemptCount,fallbackReason:d.fallbackReason});
    if(row.tick!==index)throw new Error('Decision ticks must be ordered and complete');
    return row;
  });
  validateHistory(rows);
  return rows;
}
function validateHistory(rows:readonly PublicDecisionRecord[]):void {
  for(let i=0;i<rows.length;i++){
    const expected=rows.slice(Math.max(0,i-5),i).map(d=>({tick:d.tick,action:d.appliedAction}));
    if(canonical(rows[i]!.observation.recentActions)!==canonical(expected))throw new Error('Decision history does not match committed actions');
  }
}
function summarize(rows:readonly PublicDecisionRecord[]):EpisodeReport['decisionSummary']{
  return summary.parse({turns:120,rules:rows.filter(r=>r.origin==='rules').length,mock:rows.filter(r=>r.origin==='mock').length,fallback:rows.filter(r=>r.origin==='fallback').length,forcedWait:rows.filter(r=>r.origin==='forced_wait').length,attemptedRequests:rows.reduce((n,r)=>n+r.attemptCount,0),networkCalls:0});
}
export function createEpisodeReport(input:EpisodeExportInput):EpisodeReport {
  const rows=decisions(input);
  const finalState=SimulatorStateSchema.parse(input.finalState);
  const resolutions=input.resolutions.map(r=>publicResolution.parse({customerId:publicId(r.customerId),arrivalTick:r.arrivalTick,tick:r.tick,waitMinutes:r.waitMinutes,outcome:r.outcome}));
  return parseReport({schemaVersion:'episode-report-1',episodeId:input.episodeId,mode:input.mode,policy:input.policy,scenario:input.scenario,classification:'offline-development',contracts:CONTRACT_VERSIONS,hashes:{configurationHash:input.configurationHash,scheduleHash:input.scheduleHash,finalHash:input.finalHash,traceHash:input.traceHash},sourceProvenance:input.sourceProvenance,units:{gameCurrency:'SGD',profit:'cents',utility:'points',wait:'game-minutes',satisfaction:'0-100'},finalState,resolutions,metrics:episodeMetrics(finalState,resolutions,input.stockoutTicks),decisionSummary:summarize(rows)});
}
export function exportEpisodeJson(input:EpisodeExportInput):string{return JSON.stringify(createEpisodeReport(input),null,2)+'\n';}
export function loadEpisodeJson(text:string):EpisodeReport {return parseReport(JSON.parse(text) as unknown);}

const csvColumns=['schemaVersion','episodeId','mode','policy','scenario','profitCents','utilityPoints','gameCurrency','profitUnit','utilityUnit','contractsJson','hashesJson','sourceProvenanceJson','finalStateJson','resolutionsJson','metricsJson','decisionSummaryJson'] as const;
// Text columns are fixed enums/UUIDs/hashes or JSON objects/arrays, never arbitrary spreadsheet formulas.
function csvCell(value:string):string{return /[",\r\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value;}
export function exportEpisodeCsv(input:EpisodeExportInput):string {
  const r=createEpisodeReport(input);
  const values=[r.schemaVersion,r.episodeId,r.mode,r.policy,r.scenario,String(r.metrics.profitCents),String(r.metrics.utilityPoints),'SGD','cents','points',JSON.stringify(r.contracts),JSON.stringify(r.hashes),JSON.stringify(r.sourceProvenance),JSON.stringify(r.finalState),JSON.stringify(r.resolutions),JSON.stringify(r.metrics),JSON.stringify(r.decisionSummary)];
  return csvColumns.join(',')+'\r\n'+values.map(csvCell).join(',')+'\r\n';
}
function csvRows(text:string):string[][] {
  if(text.includes('\0'))throw new Error('CSV contains NUL');
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const c=text[i]!;
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell!==''||closed)throw new Error('Malformed CSV quote');quoted=true;continue;}
    if(c===','){row.push(cell);cell='';closed=false;continue;}
    if(c==='\r'||c==='\n'){
      if(c==='\r'){if(text[i+1]!=='\n')throw new Error('Bare CR in CSV');i++;}
      row.push(cell);rows.push(row);row=[];cell='';closed=false;continue;
    }
    if(closed)throw new Error('Unexpected data after CSV quoted field');cell+=c;
  }
  if(quoted)throw new Error('Truncated quoted CSV cell');
  if(cell!==''||row.length){row.push(cell);rows.push(row);}
  return rows;
}
export function loadEpisodeCsv(text:string):EpisodeReport {
  const rows=csvRows(text);
  if(rows.length!==2||rows[0]!.join(',')!==csvColumns.join(',')||rows[1]!.length!==csvColumns.length)throw new Error('CSV requires exactly one typed report row and canonical header');
  const cells=Object.fromEntries(csvColumns.map((key,i)=>[key,rows[1]![i]!])) as Record<typeof csvColumns[number],string>;
  const parsed=(name:typeof csvColumns[number])=>JSON.parse(cells[name]) as unknown;
  const r=parseReport({schemaVersion:cells.schemaVersion,episodeId:cells.episodeId,mode:cells.mode,policy:cells.policy,scenario:cells.scenario,classification:'offline-development',contracts:parsed('contractsJson'),hashes:parsed('hashesJson'),sourceProvenance:parsed('sourceProvenanceJson'),finalState:parsed('finalStateJson'),resolutions:parsed('resolutionsJson'),metrics:parsed('metricsJson'),decisionSummary:parsed('decisionSummaryJson'),units:{gameCurrency:cells.gameCurrency,profit:cells.profitUnit,utility:cells.utilityUnit,wait:'game-minutes',satisfaction:'0-100'}});
  if(cells.profitCents!==String(r.metrics.profitCents)||cells.utilityPoints!==String(r.metrics.utilityPoints))throw new Error('CSV headline scores disagree with recomputed score');
  return r;
}

const headerSchema=z.object({recordType:z.literal('manifest'),schemaVersion:z.literal('episode-jsonl-1'),episodeId:z.string().uuid(),report:reportSchema}).strict();
const resolutionRecord=z.object({recordType:z.literal('resolution'),resolutionId:z.string(),episodeId:z.string().uuid(),resolution:publicResolution}).strict();
const terminalRecord=z.object({recordType:z.literal('terminal'),episodeId:z.string().uuid(),finalState:SimulatorStateSchema}).strict();
const trailerSchema=z.object({recordType:z.literal('complete'),episodeId:z.string().uuid(),recordCount:integer,decisionCount:z.literal(120),resolutionCount:integer,sha256:HashSchema}).strict();
export interface LoadedEpisodeJsonl {report:EpisodeReport;decisions:PublicDecisionRecord[];recordCount:number}
export function exportEpisodeJsonl(input:EpisodeExportInput):string {
  const report=createEpisodeReport(input),rows=decisions(input);
  const records:unknown[]=[{recordType:'manifest',schemaVersion:'episode-jsonl-1',episodeId:report.episodeId,report},...rows,...report.resolutions.map((resolution,index)=>({recordType:'resolution',resolutionId:`${report.episodeId}:resolution:${index}`,episodeId:report.episodeId,resolution})),{recordType:'terminal',episodeId:report.episodeId,finalState:report.finalState}];
  const trailer={recordType:'complete',episodeId:report.episodeId,recordCount:records.length+1,decisionCount:120,resolutionCount:report.resolutions.length,sha256:digest(records)};
  return [...records,trailer].map(record=>JSON.stringify(record)).join('\n')+'\n';
}
/** Rejects missing completion markers, blank/malformed/type-inconsistent lines and duplicate IDs. */
export function loadEpisodeJsonl(text:string):LoadedEpisodeJsonl {
  if(!text.endsWith('\n'))throw new Error('JSONL must end in a newline; possible truncation');
  const lines=text.slice(0,-1).split('\n');
  const values=lines.map((line,index)=>{if(line.trim()==='')throw new Error(`JSONL line ${index+1}: blank line`);try{return JSON.parse(line) as unknown;}catch{throw new Error(`JSONL line ${index+1}: malformed JSON`);}});
  const parseLine=<T>(schema:z.ZodType<T>,value:unknown,index:number):T=>{try{return schema.parse(value);}catch{throw new Error(`JSONL line ${index+1}: invalid record type or shape`);}};
  const header=parseLine(headerSchema,values[0],0),trailer=parseLine(trailerSchema,values.at(-1),values.length-1);
  const report=parseReport(header.report),episodeId=header.episodeId;
  if(episodeId!==report.episodeId||trailer.episodeId!==episodeId||trailer.recordCount!==values.length||trailer.resolutionCount!==report.resolutions.length)throw new Error('JSONL completion counts/episode IDs disagree');
  const expectedLength=1+120+report.resolutions.length+1+1;
  if(values.length!==expectedLength)throw new Error('JSONL record count differs from complete episode');
  const rows:PublicDecisionRecord[]=[];const ids=new Set<string>();
  for(let i=0;i<120;i++){
    const row=parseLine(publicDecision,values[i+1],i+1);
    if(row.episodeId!==episodeId||row.tick!==i||ids.has(row.decisionId))throw new Error(`JSONL line ${i+2}: duplicate or out-of-order decision`);
    ids.add(row.decisionId);rows.push(row);
  }
  validateHistory(rows);
  for(let i=0;i<report.resolutions.length;i++){
    const index=121+i,row=parseLine(resolutionRecord,values[index],index);
    if(row.episodeId!==episodeId||row.resolutionId!==`${episodeId}:resolution:${i}`||ids.has(row.resolutionId)||canonical(row.resolution)!==canonical(report.resolutions[i]))throw new Error(`JSONL line ${index+1}: resolution mismatch or duplicate ID`);
    ids.add(row.resolutionId);
  }
  const terminalIndex=values.length-2,terminal=parseLine(terminalRecord,values[terminalIndex],terminalIndex);
  if(terminal.episodeId!==episodeId||canonical(terminal.finalState)!==canonical(report.finalState)||canonical(summarize(rows))!==canonical(report.decisionSummary))throw new Error('JSONL terminal/decision projection disagrees with recomputed report');
  if(digest(values.slice(0,-1))!==trailer.sha256)throw new Error('JSONL content checksum mismatch');
  return {report,decisions:rows,recordCount:values.length};
}


const staticHeaderSchema=z.object({recordType:z.literal('manifest'),schemaVersion:z.literal('static-jsonl-1'),visibility:z.literal('evaluator-private'),datasetMetadata:z.record(z.unknown())}).strict();
const staticTaskRecordSchema=z.object({recordType:z.literal('static-task'),taskId:z.string(),record:StaticLabeledTaskSchema}).strict();
const staticTrailerSchema=z.object({recordType:z.literal('complete'),schemaVersion:z.literal('static-jsonl-1'),recordCount:integer,taskCount:integer,sha256:HashSchema}).strict();
/** Seed/provenance-bearing static artifacts are explicitly private evaluator data, not provider inputs. */
export function exportStaticDatasetJsonl(value:StaticDataset):string {
  const dataset=StaticDatasetSchema.parse(value);
  const {records:tasks,...datasetMetadata}=dataset;
  const records:unknown[]=[{recordType:'manifest',schemaVersion:'static-jsonl-1',visibility:'evaluator-private',datasetMetadata},...tasks.map(record=>({recordType:'static-task',taskId:record.task.taskId,record}))];
  const trailer={recordType:'complete',schemaVersion:'static-jsonl-1',recordCount:records.length+1,taskCount:tasks.length,sha256:digest(records,'static-dataset-jsonl-1')};
  return [...records,trailer].map(record=>JSON.stringify(record)).join('\n')+'\n';
}
export function loadStaticDatasetJsonl(text:string):StaticDataset {
  if(!text.endsWith('\n'))throw new Error('Static JSONL must end in newline; possible truncation');
  const lines=text.slice(0,-1).split('\n');
  const values=lines.map((line,index)=>{if(line.trim()==='')throw new Error(`Static JSONL line ${index+1}: blank line`);try{return JSON.parse(line) as unknown;}catch{throw new Error(`Static JSONL line ${index+1}: malformed JSON`);}});
  const parseLine=<T>(schema:z.ZodType<T>,value:unknown,index:number):T=>{try{return schema.parse(value);}catch{throw new Error(`Static JSONL line ${index+1}: invalid record type or shape`);}};
  const header=parseLine(staticHeaderSchema,values[0],0),trailer=parseLine(staticTrailerSchema,values.at(-1),values.length-1);
  if(values.length!==trailer.recordCount||values.length!==trailer.taskCount+2)throw new Error('Static JSONL completion count mismatch');
  if(Object.hasOwn(header.datasetMetadata,'records'))throw new Error('Static JSONL tasks must appear in separate typed records');
  const seen=new Set<string>();
  const records=values.slice(1,-1).map((value,index)=>{
    const row=parseLine(staticTaskRecordSchema,value,index+1);
    if(row.taskId!==row.record.task.taskId||seen.has(row.taskId))throw new Error(`Static JSONL line ${index+2}: duplicate or mismatched task ID`);
    seen.add(row.taskId);return row.record;
  });
  if(digest(values.slice(0,-1),'static-dataset-jsonl-1')!==trailer.sha256)throw new Error('Static JSONL content checksum mismatch');
  return StaticDatasetSchema.parse({...header.datasetMetadata,records});
}
