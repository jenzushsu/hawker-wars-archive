import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, lstatSync, mkdirSync, openSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DecisionResultSchema, type DecisionResult } from '../../shared/src/index.js';

export type LedgerProvider='jev'|'zoom'|'zoom-pro';
export type LedgerErrorCode='budget'|'quota'|'duplicate'|'rate-limit'|'invalid';
export class LedgerError extends Error {
  constructor(public readonly code:LedgerErrorCode,message:string){super(message);this.name='LedgerError';}
}
export interface BudgetPool {id:string;providers:LedgerProvider[];perRunCapMicros:number;campaignCapMicros:number;priorExposure?:{micros:number;evidenceId:string}[]}
export interface VerifiedCostBound {costBoundMicros:number;evidenceId:string}
export interface LedgerConfig {
  schemaVersion:'provider-ledger-1';campaignId:string;configurationHash:string;
  allowedRunId?:string;unverifiedAllocations?:Partial<Record<LedgerProvider,VerifiedCostBound>>;
  pools:BudgetPool[];verifiedCostBounds:Partial<Record<LedgerProvider,VerifiedCostBound>>;
}
export type AttemptState='reserved'|'dispatch_intent'|'success'|'error'|'uncertain';
export interface LedgerNativeUsage {schemaVersion:'provider-native-usage-1';provider:LedgerProvider;inputUnits?:number;outputUnits?:number;unitType?:string;cachedInputTokens?:number}
export interface Attempt {
  id:string;runId:string;tick:number;provider:LedgerProvider;poolId:string;inputHash:string;costBoundMicros:number;
  createdAtMs:number;deadlineAtMs:number;state:AttemptState;dispatchAtMs:number|null;finishedAtMs:number|null;
  responseHash:string|null;result:DecisionResult|null;nativeUsage:LedgerNativeUsage|null;
}
export interface ReserveAttempt {runId:string;tick:number;provider:LedgerProvider;inputHash:string;costBoundMicros:number;deadlineAtMs?:number}
export interface FinishAttempt {status:'success'|'error'|'uncertain';result?:DecisionResult;nativeUsage?:LedgerNativeUsage;responseHash?:string}
export interface LookupAttempt {runId:string;tick:number;provider:LedgerProvider;inputHash?:string}
export interface LedgerSummary {campaignId:string;pools:{id:string;reservedMicros:number;capMicros:number;lastDispatchAtMs:number|null}[];attempts:number}
const PROVIDERS:readonly LedgerProvider[]=['jev','zoom','zoom-pro'];
const MAX_DATABASE_BYTES=128*1024*1024;
const REQUEST_LIMIT=120;
const DISPATCH_INTERVAL_MS=1000;
const DISPATCH_BURST_LIMIT=2;
const DEADLINE_MS=4000;
const DATABASE_NAME='ledger.sqlite';
function invalid(message:string):never {throw new LedgerError('invalid',message);}
function object(value:unknown,keys:readonly string[],label:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid(`${label} must be a plain object`);
  const record=value as Record<string,unknown>;
  if(Object.keys(record).some(key=>!keys.includes(key)))invalid(`Unexpected ${label} field`);
  return record;
}
function id(value:unknown,label:string):string {if(typeof value!=='string'||value.length>100||!(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).test(value))invalid(`Invalid ${label}`);return value;}
function hash(value:unknown,label:string):string {if(typeof value!=='string'||!(/^[a-f0-9]{64}$/).test(value))invalid(`Invalid ${label}`);return value;}
function integer(value:unknown,label:string,min=0):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||Object.is(value,-0)||value<min)invalid(`Invalid ${label}`);return value;}
function provider(value:unknown):LedgerProvider {if(!PROVIDERS.includes(value as LedgerProvider))invalid('Invalid provider');return value as LedgerProvider;}
function canonical(value:unknown):string {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){const r=value as Record<string,unknown>;return `{${Object.keys(r).sort().map(k=>`${JSON.stringify(k)}:${canonical(r[k])}`).join(',')}}`;}
  return invalid('Unsupported ledger JSON');
}
const digest=(value:unknown)=>createHash('sha256').update('hawker-wars|provider-ledger-1\n').update(canonical(value)).digest('hex');
function nativeUsage(input:unknown):LedgerNativeUsage {
  const v=object(input,['schemaVersion','provider','inputUnits','outputUnits','unitType','cachedInputTokens'],'native usage');
  if(v.schemaVersion!=='provider-native-usage-1')invalid('Unsupported native usage version');
  const output:LedgerNativeUsage={schemaVersion:'provider-native-usage-1',provider:provider(v.provider)};
  if(v.inputUnits!==undefined)output.inputUnits=integer(v.inputUnits,'native input units');
  if(v.outputUnits!==undefined)output.outputUnits=integer(v.outputUnits,'native output units');
  if(v.cachedInputTokens!==undefined)output.cachedInputTokens=integer(v.cachedInputTokens,'native cached input');
  if(v.unitType!==undefined){if(typeof v.unitType!=='string'||v.unitType.length<1||v.unitType.length>64||!(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).test(v.unitType))invalid('Invalid native usage unit type');output.unitType=v.unitType;}
  return output;
}

function normalizeConfig(input:unknown):LedgerConfig {
  const v=object(input,['schemaVersion','campaignId','configurationHash','pools','verifiedCostBounds','allowedRunId','unverifiedAllocations'],'ledger configuration');
  if(v.schemaVersion!=='provider-ledger-1')invalid('Unsupported ledger configuration version');
  if(!Array.isArray(v.pools)||v.pools.length<1||v.pools.length>3)invalid('One to three budget pools required');
  const pools:BudgetPool[]=v.pools.map(raw=>{
    const p=object(raw,['id','providers','perRunCapMicros','campaignCapMicros','priorExposure'],'pool');
    if(!Array.isArray(p.providers)||p.providers.length<1||p.providers.length>3)invalid('Invalid pool providers');
    const providers=p.providers.map(provider);
    if(new Set(providers).size!==providers.length)invalid('Duplicate provider in pool');
    const perRunCapMicros=integer(p.perRunCapMicros,'run cap',1),campaignCapMicros=integer(p.campaignCapMicros,'campaign cap',1);
    if(perRunCapMicros>campaignCapMicros)invalid('Run cap exceeds campaign cap');
    if(providers.some(p=>p==='zoom'||p==='zoom-pro')&&(providers.length!==2||!providers.includes('zoom')||!providers.includes('zoom-pro')||perRunCapMicros!==250000||campaignCapMicros!==5000000))invalid('Zoom must share the approved 0.25 USD run / 5 USD campaign caps');
    const priorExposure=p.priorExposure===undefined?undefined:(()=>{if(!Array.isArray(p.priorExposure)||p.priorExposure.length>10)invalid('Invalid prior exposure');return p.priorExposure.map(raw=>{const e=object(raw,['micros','evidenceId'],'prior exposure');if(typeof e.evidenceId!=='string'||e.evidenceId.length<1||e.evidenceId.length>512)invalid('Missing exposure provenance');return {micros:integer(e.micros,'prior allocation',1),evidenceId:e.evidenceId};});})();
    if(priorExposure && new Set(priorExposure.map(e=>e.evidenceId)).size!==priorExposure.length)invalid('Duplicate prior exposure');
    return {id:id(p.id,'pool id'),providers:providers.sort(),perRunCapMicros,campaignCapMicros,...(priorExposure?{priorExposure}:{})};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  if(new Set(pools.map(p=>p.id)).size!==pools.length||new Set(pools.flatMap(p=>p.providers)).size!==pools.reduce((n,p)=>n+p.providers.length,0))invalid('Duplicate pool/provider assignment');
  const bounds=object(v.verifiedCostBounds,PROVIDERS,'verified cost bounds');
  const verifiedCostBounds:LedgerConfig['verifiedCostBounds']={};
  for(const key of Object.keys(bounds)){
    const p=provider(key),b=object(bounds[p],['costBoundMicros','evidenceId'],'cost bound');
    const pool=pools.find(pool=>pool.providers.includes(p));
    if(!pool)invalid('Cost bound has no budget pool');
    const costBoundMicros=integer(b.costBoundMicros,'cost bound',1);
    if(costBoundMicros>pool.perRunCapMicros)invalid('Verified request bound exceeds run cap');
    if(typeof b.evidenceId!=='string'||b.evidenceId.length<1||b.evidenceId.length>512||!(/^[\x20-\x7e]+$/).test(b.evidenceId))invalid('Cost bound needs bounded evidence provenance');
    verifiedCostBounds[p]={costBoundMicros,evidenceId:b.evidenceId};
  }
  const allowedRunId=v.allowedRunId===undefined?undefined:id(v.allowedRunId,'approved run');
  let unverifiedAllocations:LedgerConfig['unverifiedAllocations'];
  if(v.unverifiedAllocations!==undefined){
    if(!allowedRunId)invalid('Unverified allocations require one approved run');
    const values=object(v.unverifiedAllocations,['zoom','zoom-pro'],'unverified allocations');unverifiedAllocations={};
    for(const key of Object.keys(values)){const p=provider(key),b=object(values[p],['costBoundMicros','evidenceId'],'allocation');if(verifiedCostBounds[p])invalid('Cannot label allocation as verified');if(b.costBoundMicros!==1000||typeof b.evidenceId!=='string'||b.evidenceId.length<1||b.evidenceId.length>512)invalid('Invalid operator allocation');unverifiedAllocations[p]={costBoundMicros:1000,evidenceId:b.evidenceId};}
  }
  return {schemaVersion:'provider-ledger-1',campaignId:id(v.campaignId,'campaign id'),configurationHash:hash(v.configurationHash,'configuration hash'),pools,verifiedCostBounds,...(allowedRunId?{allowedRunId}:{}),...(unverifiedAllocations?{unverifiedAllocations}:{})};
}
const schemaSQL=`
PRAGMA user_version=2;
CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), configuration TEXT NOT NULL, digest TEXT NOT NULL) STRICT;
CREATE TABLE pools (pool_id TEXT PRIMARY KEY, reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0), last_dispatch_ms INTEGER) STRICT;
CREATE TABLE runs (pool_id TEXT NOT NULL REFERENCES pools(pool_id), run_id TEXT NOT NULL, reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0), PRIMARY KEY(pool_id,run_id)) STRICT;
CREATE TABLE attempts (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tick INTEGER NOT NULL CHECK(tick BETWEEN 0 AND 119), provider TEXT NOT NULL CHECK(provider IN ('jev','zoom','zoom-pro')),
 pool_id TEXT NOT NULL REFERENCES pools(pool_id), input_hash TEXT NOT NULL, cost_bound_micros INTEGER NOT NULL CHECK(cost_bound_micros>0),
 created_ms INTEGER NOT NULL, deadline_ms INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('reserved','dispatch_intent','success','error','uncertain')),
 dispatch_ms INTEGER, finished_ms INTEGER, response_hash TEXT, result_json TEXT, native_usage_json TEXT, UNIQUE(run_id,tick,provider)
) STRICT;
`;
function connection(path:string):DatabaseSync {
  const db=new DatabaseSync(path,{timeout:0,allowExtension:false,enableForeignKeyConstraints:true,enableDoubleQuotedStringLiterals:false,defensive:true});
  db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
  return db;
}
function secureDirectory(directory:string):{dev:number;ino:number} {
  const s=lstatSync(directory);
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0)invalid('Ledger directory must be private and real');
  return {dev:s.dev,ino:s.ino};
}
function secureFile(path:string):{dev:number;ino:number} {
  const s=lstatSync(path);
  if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.size>MAX_DATABASE_BYTES)invalid('Ledger database must be private, regular and bounded');
  return {dev:s.dev,ino:s.ino};
}
function rowToAttempt(raw:unknown):Attempt {
  const row=raw as Record<string,unknown>;
  const result=row.result_json===null?null:DecisionResultSchema.parse(JSON.parse(String(row.result_json)));
  const usage=row.native_usage_json===null?null:nativeUsage(JSON.parse(String(row.native_usage_json)));
  const state=row.state;
  if(!['reserved','dispatch_intent','success','error','uncertain'].includes(String(state)))invalid('Invalid stored attempt state');
  const a:Attempt={id:id(row.id,'stored attempt id'),runId:id(row.run_id,'stored run id'),tick:integer(row.tick,'stored tick'),provider:provider(row.provider),poolId:id(row.pool_id,'stored pool id'),inputHash:hash(row.input_hash,'stored input hash'),costBoundMicros:integer(row.cost_bound_micros,'stored bound',1),createdAtMs:integer(row.created_ms,'stored creation'),deadlineAtMs:integer(row.deadline_ms,'stored deadline'),state:state as AttemptState,dispatchAtMs:row.dispatch_ms===null?null:integer(row.dispatch_ms,'stored dispatch'),finishedAtMs:row.finished_ms===null?null:integer(row.finished_ms,'stored finish'),responseHash:row.response_hash===null?null:hash(row.response_hash,'stored response hash'),result,nativeUsage:usage};
  if(a.tick>119||a.deadlineAtMs<a.createdAtMs||a.deadlineAtMs>a.createdAtMs+DEADLINE_MS)invalid('Invalid stored attempt deadline');
  if(a.dispatchAtMs!==null&&(a.dispatchAtMs<a.createdAtMs||a.dispatchAtMs>a.deadlineAtMs))invalid('Invalid stored dispatch time');
  if(a.state==='reserved'&&(a.dispatchAtMs!==null||a.finishedAtMs!==null||a.result!==null)||a.state==='dispatch_intent'&&(a.dispatchAtMs===null||a.finishedAtMs!==null||a.result!==null)||['success','error','uncertain'].includes(a.state)&&a.finishedAtMs===null||a.state==='success'&&(a.dispatchAtMs===null||a.result?.status!=='success')||a.state==='uncertain'&&(a.dispatchAtMs===null||a.result!==null))invalid('Invalid stored attempt transition');
  if(a.finishedAtMs!==null&&(a.finishedAtMs<a.createdAtMs||(a.dispatchAtMs!==null&&a.finishedAtMs<a.dispatchAtMs)||(a.state==='success'&&a.finishedAtMs>a.deadlineAtMs)))invalid('Invalid stored completion time');
  if(a.result&&(a.result.provider!==a.provider||a.result.latencyMs>DEADLINE_MS||a.responseHash!==digest({result:a.result,nativeUsage:a.nativeUsage})))invalid('Stored response attribution/hash mismatch');
  if(a.nativeUsage&&(!a.result||a.nativeUsage.provider!==a.provider))invalid('Stored native usage attribution mismatch');
  return a;
}

/** Durable ledger. All callers for one campaign must open the same retained directory. */
export class Ledger {
  readonly #db:DatabaseSync;readonly #directory:string;readonly #path:string;readonly #identity:{dev:number;ino:number};readonly #directoryIdentity:{dev:number;ino:number};readonly #config:LedgerConfig;readonly #configDigest:string;#closed=false;
  constructor(directory:string,db:DatabaseSync,config:LedgerConfig){
    this.#directory=directory;this.#path=join(directory,DATABASE_NAME);this.#db=db;this.#config=structuredClone(config);this.#configDigest=digest(config);this.#identity=secureFile(this.#path);this.#directoryIdentity=secureDirectory(directory);
  }
  get config():LedgerConfig{return structuredClone(this.#config);}
  getCostBound(p:LedgerProvider):number|null{return (this.#config.verifiedCostBounds[provider(p)]??this.#config.unverifiedAllocations?.[provider(p)])?.costBoundMicros??null;}
  #guard():void {
    if(this.#closed)invalid('Ledger is closed');
    try{
      const dir=secureDirectory(this.#directory),file=secureFile(this.#path);
      if(dir.dev!==this.#directoryIdentity.dev||dir.ino!==this.#directoryIdentity.ino||file.dev!==this.#identity.dev||file.ino!==this.#identity.ino)invalid('Ledger was replaced or removed; refusing automatic reset');
      const meta=this.#db.prepare('SELECT configuration,digest FROM metadata WHERE id=1').get()as {configuration:string;digest:string}|undefined;
      if(!meta||meta.digest!==this.#configDigest||meta.configuration!==canonical(this.#config))invalid('Ledger configuration changed');
    }catch(e){if(e instanceof LedgerError)throw e;invalid('Ledger storage is unavailable or corrupt');}
  }
  #transaction<T>(operation:()=>T):T {
    this.#guard();let began=false;
    try{this.#db.exec('BEGIN IMMEDIATE');began=true;this.#guard();const value=operation();this.#db.exec('COMMIT');return value;}
    catch(e){if(began){try{this.#db.exec('ROLLBACK');}catch{/* fail closed */}}if(e instanceof LedgerError)throw e;return invalid('Ledger transaction failed; no dispatch authorized');}
  }
  #byId(attemptId:string):Attempt {const row=this.#db.prepare('SELECT * FROM attempts WHERE id=?').get(id(attemptId,'attempt id'));if(!row)invalid('Unknown attempt');return rowToAttempt(row);}
  lookupAttempt(input:LookupAttempt):Attempt|null {
    const r=object(input,['runId','tick','provider','inputHash'],'lookup');const runId=id(r.runId,'run id'),tick=integer(r.tick,'tick'),p=provider(r.provider);
    if(tick>119)invalid('Tick must be 0 through 119');if(r.inputHash!==undefined)hash(r.inputHash,'input hash');
    return this.#transaction(()=>{const row=this.#db.prepare('SELECT * FROM attempts WHERE run_id=? AND tick=? AND provider=?').get(runId,tick,p);if(!row)return null;const a=rowToAttempt(row);if(r.inputHash!==undefined&&a.inputHash!==r.inputHash)invalid('Attempt input differs from original captured input');return a;});
  }
  #reportedExposure(poolId:string,runId:string|null):number {
    const rows=this.#db.prepare('SELECT provider,cost_bound_micros,native_usage_json FROM attempts WHERE pool_id=? AND (? IS NULL OR run_id=?)').all(poolId,runId,runId);
    return rows.reduce((sum,row)=>{const usage=row.native_usage_json?nativeUsage(JSON.parse(String(row.native_usage_json))):null;const rate=row.provider==='zoom'?0.042:row.provider==='zoom-pro'?0.10:0;const metered=usage?.unitType==='tokens'&&usage.inputUnits!==undefined?Math.ceil(usage.inputUnits*rate):0;return sum+Math.max(Number(row.cost_bound_micros),metered);},0);
  }
  reserveAttempt(input:ReserveAttempt):Attempt {
    const r=object(input,['runId','tick','provider','inputHash','costBoundMicros','deadlineAtMs'],'reservation');
    const runId=id(r.runId,'run id'),tick=integer(r.tick,'tick'),p=provider(r.provider),inputHash=hash(r.inputHash,'input hash'),costBoundMicros=integer(r.costBoundMicros,'cost bound',1);
    if(tick>119)invalid('Tick must be 0 through 119');
    if(this.#config.allowedRunId && runId!==this.#config.allowedRunId)invalid('Run is outside campaign approval');
    const bound=this.#config.verifiedCostBounds[p]??this.#config.unverifiedAllocations?.[p],pool=this.#config.pools.find(pool=>pool.providers.includes(p));
    if(!bound||!pool)throw new LedgerError('quota','Provider lacks a configured verified request bound and budget');
    if(costBoundMicros!==bound.costBoundMicros)invalid('Request cost bound differs from verified configuration');
    return this.#transaction(()=>{
      const old=this.#db.prepare('SELECT * FROM attempts WHERE run_id=? AND tick=? AND provider=?').get(runId,tick,p);
      if(old){const a=rowToAttempt(old);if(a.inputHash!==inputHash)invalid('Attempt input differs from original captured input');throw new LedgerError('duplicate','Attempt already reserved; never redispatch');}
      const requests=Number((this.#db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE run_id=? AND provider=?').get(runId,p)as {n:number}).n);
      if(requests>=REQUEST_LIMIT)throw new LedgerError('quota','Provider request limit reached for this run');
      const poolRow=this.#db.prepare('SELECT reserved_micros FROM pools WHERE pool_id=?').get(pool.id)as {reserved_micros:number};
      const runRow=this.#db.prepare('SELECT reserved_micros FROM runs WHERE pool_id=? AND run_id=?').get(pool.id,runId)as {reserved_micros:number}|undefined;
      const unverified=!!this.#config.unverifiedAllocations?.[p];
      const campaignExposure=unverified?this.#reportedExposure(pool.id,null)+(pool.priorExposure??[]).reduce((n,e)=>n+e.micros,0):poolRow.reserved_micros;
      const runExposure=unverified?this.#reportedExposure(pool.id,runId):(runRow?.reserved_micros??0);
      if(campaignExposure+costBoundMicros>pool.campaignCapMicros||runExposure+costBoundMicros>pool.perRunCapMicros)throw new LedgerError('budget','Approved shared run or campaign budget exhausted');
      const now=integer(Date.now(),'current time'),deadline=r.deadlineAtMs===undefined?now+DEADLINE_MS:integer(r.deadlineAtMs,'deadline');
      if(deadline<now||deadline>now+DEADLINE_MS)invalid('Deadline must be within the original four-second window');
      const attemptId=randomUUID();
      this.#db.prepare('INSERT INTO attempts(id,run_id,tick,provider,pool_id,input_hash,cost_bound_micros,created_ms,deadline_ms,state,dispatch_ms,finished_ms,response_hash,result_json,native_usage_json) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL,NULL)').run(attemptId,runId,tick,p,pool.id,inputHash,costBoundMicros,now,deadline,'reserved');
      this.#db.prepare('UPDATE pools SET reserved_micros=reserved_micros+? WHERE pool_id=?').run(costBoundMicros,pool.id);
      this.#db.prepare('INSERT INTO runs(pool_id,run_id,reserved_micros) VALUES(?,?,?) ON CONFLICT(pool_id,run_id) DO UPDATE SET reserved_micros=reserved_micros+excluded.reserved_micros').run(pool.id,runId,costBoundMicros);
      return this.#byId(attemptId);
    });
  }
  markDispatchIntent(attemptId:string):Attempt {
    return this.#transaction(()=>{
      const a=this.#byId(attemptId);if(a.state!=='reserved')throw new LedgerError('duplicate','Dispatch intent already exists or attempt is closed; never redispatch');
      const now=integer(Date.now(),'current time');if(now<a.createdAtMs||now>a.deadlineAtMs)throw new LedgerError('quota','Original attempt deadline elapsed');
      const row=this.#db.prepare('SELECT last_dispatch_ms FROM pools WHERE pool_id=?').get(a.poolId)as {last_dispatch_ms:number|null};
      if(row.last_dispatch_ms!==null&&now<row.last_dispatch_ms)throw new LedgerError('rate-limit','Clock precedes latest shared pool dispatch');
      const recent=Number((this.#db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE pool_id=? AND dispatch_ms>? AND dispatch_ms<=?').get(a.poolId,now-DISPATCH_INTERVAL_MS,now)as {n:number}).n);
      if(recent>=DISPATCH_BURST_LIMIT)throw new LedgerError('rate-limit','Shared pool two-request rolling-window limit reached');
      this.#db.prepare("UPDATE attempts SET state='dispatch_intent',dispatch_ms=? WHERE id=?").run(now,a.id);
      this.#db.prepare('UPDATE pools SET last_dispatch_ms=? WHERE pool_id=?').run(now,a.poolId);
      return this.#byId(a.id);
    });
  }
  finishAttempt(attemptId:string,input:FinishAttempt):Attempt {
    const r=object(input,['status','result','nativeUsage','responseHash'],'attempt completion');
    if(!['success','error','uncertain'].includes(String(r.status)))invalid('Invalid attempt completion status');
    const status=r.status as FinishAttempt['status'];
    const parsed=r.result===undefined?null:DecisionResultSchema.safeParse(r.result);
    if(parsed&&!parsed.success)invalid('Invalid sanitized decision result');
    const result=parsed&&parsed.success?parsed.data:null;
    const usage=r.nativeUsage===undefined?null:nativeUsage(r.nativeUsage);
    if(usage&&!result)invalid('Native usage requires a sanitized result');
    const responseHash=result?digest({result,nativeUsage:usage}):r.responseHash===undefined?null:hash(r.responseHash,'response hash');
    return this.#transaction(()=>{
      const a=this.#byId(attemptId);
      if(['success','error','uncertain'].includes(a.state)){
        if(a.state===status&&canonical(a.result)===canonical(result)&&canonical(a.nativeUsage)===canonical(usage)&&a.responseHash===responseHash)return a;
        throw new LedgerError('duplicate','Original attempt is finalized; late results cannot replace it');
      }
      const now=integer(Date.now(),'current time');
      if(now<a.createdAtMs)invalid('Completion time precedes original attempt');
      if(result&&result.provider!==a.provider)invalid('Response belongs to a different provider');
      if(usage&&usage.provider!==a.provider)invalid('Native usage belongs to a different provider');
      if(result&&result.latencyMs>DEADLINE_MS)invalid('Response exceeds common deadline');
      if(status==='success'&&(a.state!=='dispatch_intent'||result?.status!=='success'||now<a.createdAtMs||now>a.deadlineAtMs))invalid('Success requires an on-time result for the original dispatch intent');
      if(status==='error'&&result&&result.status==='success')invalid('Error completion cannot claim successful result');
      if(status==='uncertain'&&(a.state!=='dispatch_intent'||result!==null||responseHash!==null))invalid('Uncertain attempts retain charge without a result');
      this.#db.prepare('UPDATE attempts SET state=?,finished_ms=?,response_hash=?,result_json=?,native_usage_json=? WHERE id=?').run(status,now,responseHash,result?canonical(result):null,usage?canonical(usage):null,a.id);
      // Intentionally no refund/release. FULL conservative cost remains charged to both caps forever.
      return this.#byId(a.id);
    });
  }
  summary():LedgerSummary {return this.#transaction(()=>({campaignId:this.#config.campaignId,pools:this.#config.pools.map(pool=>{const row=this.#db.prepare('SELECT reserved_micros,last_dispatch_ms FROM pools WHERE pool_id=?').get(pool.id)as {reserved_micros:number;last_dispatch_ms:number|null};return {id:pool.id,reservedMicros:row.reserved_micros,capMicros:pool.campaignCapMicros,lastDispatchAtMs:row.last_dispatch_ms};}),attempts:Number((this.#db.prepare('SELECT COUNT(*) AS n FROM attempts').get()as {n:number}).n)}));}
  usageReport():unknown {return this.#transaction(()=>({
    accountingBasis:this.#config.unverifiedAllocations?'Jev verified reservations; Zoom operator allocations, not guaranteed charges':'verified reservations',
    priorExposure:this.#config.pools.flatMap(p=>p.priorExposure??[]),
    runs:this.#db.prepare("SELECT run_id,provider,state,COUNT(*) attempts,SUM(cost_bound_micros) allocated_micros,SUM(json_extract(native_usage_json,'$.inputUnits')) reported_input_units,AVG(json_extract(result_json,'$.latencyMs')) mean_latency_ms,MAX(json_extract(result_json,'$.latencyMs')) max_latency_ms FROM attempts GROUP BY run_id,provider,state ORDER BY run_id,provider,state").all(),
    providers:this.#db.prepare("SELECT provider,state,COUNT(*) attempts, SUM(cost_bound_micros) allocated_micros, SUM(CASE WHEN json_extract(native_usage_json,'$.unitType')='tokens' THEN json_extract(native_usage_json,'$.inputUnits') ELSE 0 END) reported_input_tokens FROM attempts GROUP BY provider,state ORDER BY provider,state").all(),
  }));}
  /** Explicit operator amendment; retains every attempt, reservation and dispatch timestamp.
   * Close all workers first. Existing handles fail closed after the identity changes. */
  amendBudget(input:LedgerConfig,approvalReference:string,previousRunId?:string):void {
    const next=normalizeConfig(input);
    const transition = previousRunId !== undefined;
    if(transition && (!this.#config.allowedRunId || previousRunId!==this.#config.allowedRunId || !next.allowedRunId || next.allowedRunId===previousRunId))invalid('Run transition requires the current and a different next run');
    if(this.#config.allowedRunId && next.allowedRunId!==this.#config.allowedRunId && !transition)invalid('Cannot replace approved run');
    if(this.#config.unverifiedAllocations && canonical(next.unverifiedAllocations)!==canonical(this.#config.unverifiedAllocations)) {
      if(!transition)invalid('Cannot replace operator allocations');
      for(const p of PROVIDERS)if(this.#config.unverifiedAllocations[p]?.costBoundMicros!==next.unverifiedAllocations?.[p]?.costBoundMicros)invalid('Run transition cannot change operator allocation amounts');
    }

    if(!approvalReference || approvalReference.length>512 || !/^[\x20-\x7e]+$/.test(approvalReference))invalid('Approval reference required');
    if(next.campaignId!==this.#config.campaignId || next.configurationHash===this.#config.configurationHash)invalid('Amendment requires the same campaign and a new configuration identity');
    if(canonical(next.verifiedCostBounds)!==canonical(this.#config.verifiedCostBounds))invalid('Budget amendment cannot change verified request bounds');
    if(next.pools.length!==this.#config.pools.length)invalid('Budget amendment cannot change pools');
    for(const old of this.#config.pools){
      const pool=next.pools.find(p=>p.id===old.id);
      if(!pool || canonical(pool.providers)!==canonical(old.providers) || pool.perRunCapMicros<old.perRunCapMicros || pool.campaignCapMicros<old.campaignCapMicros)invalid('Budget amendment cannot remove assignments or lower caps');
    }
    for(const old of this.#config.pools){const pool=next.pools.find(p=>p.id===old.id)!;for(const exposure of old.priorExposure??[]){if(!(pool.priorExposure??[]).some(e=>canonical(e)===canonical(exposure)))invalid('Cannot remove prior exposure');}}
    this.validateStorage();
    this.#transaction(()=>{for(const old of this.#config.pools){const pool=next.pools.find(p=>p.id===old.id)!;const added=(pool.priorExposure??[]).reduce((n,e)=>n+e.micros,0)-(old.priorExposure??[]).reduce((n,e)=>n+e.micros,0);this.#db.prepare('UPDATE pools SET reserved_micros=reserved_micros+? WHERE pool_id=?').run(added,old.id);const row=this.#db.prepare('SELECT reserved_micros FROM pools WHERE pool_id=?').get(old.id) as {reserved_micros:number};if(row.reserved_micros>pool.campaignCapMicros)invalid('Prior exposure exceeds cap');}

      this.#db.exec('CREATE TABLE IF NOT EXISTS budget_amendments (id INTEGER PRIMARY KEY, previous_configuration TEXT NOT NULL, next_configuration TEXT NOT NULL, approval_reference TEXT NOT NULL, amended_ms INTEGER NOT NULL) STRICT');
      this.#db.prepare('INSERT INTO budget_amendments(previous_configuration,next_configuration,approval_reference,amended_ms) VALUES(?,?,?,?)').run(canonical(this.#config),canonical(next),approvalReference,integer(Date.now(),'amendment time'));
      this.#db.prepare('UPDATE metadata SET configuration=?,digest=? WHERE id=1').run(canonical(next),digest(next));
    });
    this.close();
  }
  close():void {if(!this.#closed){this.#db.close();this.#closed=true;}}
  /** Validate persisted totals and states while holding an exclusive transaction snapshot. */
  validateStorage():void {this.#transaction(()=>{
    const integrity=this.#db.prepare('PRAGMA integrity_check').all();if(integrity.length!==1||Object.values(integrity[0]??{})[0]!=='ok')invalid('Ledger integrity check failed');
    const actualPools=this.#db.prepare('SELECT pool_id,reserved_micros,last_dispatch_ms FROM pools ORDER BY pool_id').all();
    if(actualPools.length!==this.#config.pools.length)invalid('Ledger budget pools changed');
    for(const pool of this.#config.pools){
      const stored=actualPools.find(row=>row.pool_id===pool.id);if(!stored)invalid('Ledger budget pool missing');
      const total=Number((this.#db.prepare('SELECT COALESCE(SUM(cost_bound_micros),0) AS n FROM attempts WHERE pool_id=?').get(pool.id)as {n:number}).n);
      if(total+(pool.priorExposure??[]).reduce((n,e)=>n+e.micros,0)!==stored.reserved_micros||Number(stored.reserved_micros)>pool.campaignCapMicros)invalid('Campaign reservation totals mismatch');
      const last=this.#db.prepare('SELECT MAX(dispatch_ms) AS n FROM attempts WHERE pool_id=?').get(pool.id)as {n:number|null};
      if(last.n!==stored.last_dispatch_ms)invalid('Dispatch spacing state mismatch');
    }
    for(const row of this.#db.prepare('SELECT * FROM runs').all()){
      const pool=this.#config.pools.find(p=>p.id===row.pool_id);if(!pool)invalid('Unknown stored run pool');
      const total=Number((this.#db.prepare('SELECT COALESCE(SUM(cost_bound_micros),0) AS n FROM attempts WHERE pool_id=? AND run_id=?').get(String(row.pool_id),String(row.run_id))as {n:number}).n);
      if(total!==row.reserved_micros||total>pool.perRunCapMicros)invalid('Run reservation totals mismatch');
    }
    for(const row of this.#db.prepare('SELECT * FROM attempts').all()){
      const a=rowToAttempt(row),pool=this.#config.pools.find(p=>p.id===a.poolId),bound=this.#config.verifiedCostBounds[a.provider]??this.#config.unverifiedAllocations?.[a.provider];
      if(!pool?.providers.includes(a.provider)||!bound||a.costBoundMicros!==bound.costBoundMicros)invalid('Stored attempt bound/provider mismatch');
      if(!this.#db.prepare('SELECT 1 AS n FROM runs WHERE pool_id=? AND run_id=?').get(a.poolId,a.runId))invalid('Attempt run reservation missing');
    }
    const excess=this.#db.prepare('SELECT 1 AS n FROM attempts GROUP BY run_id,provider HAVING COUNT(*)>120 LIMIT 1').get();if(excess)invalid('Stored provider request quota exceeded');
  });}
}

/** Explicit one-time initialization. Never call this implicitly when opening a missing ledger. */
export function initializeLedger(directory:string,input:LedgerConfig):Ledger {
  const config=normalizeConfig(input),root=resolve(directory),path=join(root,DATABASE_NAME);let created=false,db:DatabaseSync|undefined;
  try{
    mkdirSync(root,{mode:0o700});created=true;
    const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_RDWR,0o600);closeSync(fd);
    db=connection(path);db.exec('BEGIN IMMEDIATE');db.exec(schemaSQL);
    db.prepare('INSERT INTO metadata(id,configuration,digest) VALUES(1,?,?)').run(canonical(config),digest(config));
    for(const pool of config.pools)db.prepare('INSERT INTO pools(pool_id,reserved_micros,last_dispatch_ms) VALUES(?,?,NULL)').run(pool.id,(pool.priorExposure??[]).reduce((n,e)=>n+e.micros,0));
    db.exec('COMMIT');const ledger=new Ledger(root,db,config);ledger.validateStorage();return ledger;
  }catch(e){
    try{db?.close();}catch{/* leave original error */}
    if(created){for(const name of [DATABASE_NAME,`${DATABASE_NAME}-journal`]){try{rmSync(join(root,name));}catch{/* only files this initializer may have made */}}try{rmdirSync(root);}catch{/* preserve any unexpected user contents */}}
    if(e instanceof LedgerError)throw e;return invalid('Ledger initialization failed; existing paths are never overwritten');
  }
}
/** Opens an existing initialized ledger only. Missing/corrupt state must never reset a campaign. */
export function openLedger(directory:string,expected:{campaignId:string;configurationHash:string}):Ledger {
  const root=resolve(directory),path=join(root,DATABASE_NAME);let db:DatabaseSync|undefined;
  try{
    id(expected.campaignId,'expected campaign id');hash(expected.configurationHash,'expected configuration hash');secureDirectory(root);secureFile(path);
    if(readdirSync(root).some(name=>![DATABASE_NAME,`${DATABASE_NAME}-journal`].includes(name)))invalid('Unexpected files in ledger directory');
    db=connection(path);const version=db.prepare('PRAGMA user_version').get();if(Object.values(version??{})[0]!==2)invalid('Unsupported ledger database version');
    const meta=db.prepare('SELECT configuration,digest FROM metadata WHERE id=1').get()as {configuration:string;digest:string}|undefined;
    if(!meta||typeof meta.configuration!=='string'||meta.configuration.length>65536)invalid('Missing bounded ledger configuration');
    const config=normalizeConfig(JSON.parse(meta.configuration));
    if(meta.digest!==digest(config)||meta.configuration!==canonical(config)||config.campaignId!==expected.campaignId||config.configurationHash!==expected.configurationHash)invalid('Ledger campaign/configuration identity mismatch');
    const ledger=new Ledger(root,db,config);ledger.validateStorage();return ledger;
  }catch(e){try{db?.close();}catch{/* fail closed */}if(e instanceof LedgerError)throw e;return invalid('Existing ledger is unavailable or corrupt; refusing automatic initialization');}
}
