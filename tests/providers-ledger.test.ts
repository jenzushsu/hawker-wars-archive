import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { initializeLedger, openLedger, LedgerError, type Ledger, type LedgerConfig } from '../packages/providers/src/ledger.js';

const configHash='a'.repeat(64),inputHash='b'.repeat(64);
const paths:string[]=[],handles:Ledger[]=[];
const zoomConfig=(cost=100000):LedgerConfig=>({schemaVersion:'provider-ledger-1',campaignId:'zoom-trial-campaign-1',configurationHash:configHash,pools:[{id:'zoom-shared',providers:['zoom','zoom-pro'],perRunCapMicros:250000,campaignCapMicros:5000000}],verifiedCostBounds:{zoom:{costBoundMicros:cost,evidenceId:'test-only verified bound'},'zoom-pro':{costBoundMicros:cost,evidenceId:'test-only verified bound'}}});
function path(){const p=mkdtempSync(join(tmpdir(),'hawker-ledger-test-'));paths.push(p);return join(p,'ledger');}
function init(directory:string,config=zoomConfig()){const l=initializeLedger(directory,config);handles.push(l);return l;}
function reopen(directory:string,campaignId='zoom-trial-campaign-1'){const l=openLedger(directory,{campaignId,configurationHash:configHash});handles.push(l);return l;}
const reserve=(l:Ledger,runId='run-1',tick=0,provider:'zoom'|'zoom-pro'='zoom',cost=100000)=>l.reserveAttempt({runId,tick,provider,inputHash,costBoundMicros:cost});
function expectCode(operation:()=>unknown,code:string){try{operation();throw new Error('Expected rejection');}catch(e){expect(e).toBeInstanceOf(LedgerError);expect((e as LedgerError).code).toBe(code);}}
afterEach(()=>{vi.restoreAllMocks();for(const l of handles.splice(0))l.close();for(const p of paths.splice(0))rmSync(p,{recursive:true,force:true});});

describe('durable conservative attempt and budget ledger',()=>{
 it('requires explicit initialization and preserves any existing directory/user data',()=>{
  const p=path();expect(()=>reopen(p)).toThrow();expect(existsSync(p)).toBe(false);
  mkdirSync(p);writeFileSync(join(p,'user.txt'),'preserve');expect(()=>init(p)).toThrow();expect(readFileSync(join(p,'user.txt'),'utf8')).toBe('preserve');
 });
 it('creates a private database and requires matching campaign/configuration identities',()=>{
  const p=path(),l=init(p);expect(lstatSync(p).mode&0o777).toBe(0o700);expect(lstatSync(join(p,'ledger.sqlite')).mode&0o777).toBe(0o600);
  expect(l.getCostBound('zoom')).toBe(100000);expect(l.getCostBound('jev')).toBeNull();
  expect(()=>openLedger(p,{campaignId:'other',configurationHash:configHash})).toThrow();
  expect(()=>openLedger(p,{campaignId:l.config.campaignId,configurationHash:'c'.repeat(64)})).toThrow();
  const copy=l.config;copy.pools[0]!.campaignCapMicros=999999999;expect(l.config.pools[0]!.campaignCapMicros).toBe(5000000);
 });
 it('uses one shared run cap for Standard+Pro and never refunds successful/error attempts',()=>{
  const p=path(),l=init(p);let now=10000;vi.spyOn(Date,'now').mockImplementation(()=>now);
  const first=reserve(l);l.markDispatchIntent(first.id);l.finishAttempt(first.id,{status:'success',result:{provider:'zoom',action:'WAIT',status:'success',latencyMs:10},nativeUsage:{schemaVersion:'provider-native-usage-1',provider:'zoom',inputUnits:12,outputUnits:1,unitType:'tokens'}});
  now+=1000;const second=reserve(l,'run-1',0,'zoom-pro');l.markDispatchIntent(second.id);l.finishAttempt(second.id,{status:'error'});
  expectCode(()=>reserve(l,'run-1',1),'budget');expect(l.summary().pools[0]!.reservedMicros).toBe(200000);
  const recovered=reopen(p).lookupAttempt({runId:'run-1',tick:0,provider:'zoom',inputHash});expect(recovered?.result?.action).toBe('WAIT');expect(recovered?.nativeUsage).toMatchObject({inputUnits:12,outputUnits:1,unitType:'tokens'});
  expectCode(()=>reserve(l),'duplicate');expectCode(()=>l.reserveAttempt({runId:'run-1',tick:0,provider:'zoom',inputHash:'d'.repeat(64),costBoundMicros:100000}),'invalid');
 });
 it('retains uncertain charges across process restart and rejects every redispatch path',()=>{
  const p=path(),l=init(p),a=reserve(l);l.markDispatchIntent(a.id);l.close();const recovered=reopen(p);
  const old=recovered.lookupAttempt({runId:'run-1',tick:0,provider:'zoom'})!;expect(old.state).toBe('dispatch_intent');
  expectCode(()=>recovered.markDispatchIntent(a.id),'duplicate');expectCode(()=>reserve(recovered),'duplicate');
  recovered.finishAttempt(a.id,{status:'uncertain'});expect(recovered.summary().pools[0]!.reservedMicros).toBe(100000);
  expectCode(()=>recovered.finishAttempt(a.id,{status:'success',result:{provider:'zoom',action:'WAIT',status:'success',latencyMs:0}}),'duplicate');
 });
 it('retains un-dispatched reservations after crashes without resetting original deadlines',()=>{
  const p=path();let now=10000;vi.spyOn(Date,'now').mockImplementation(()=>now);const l=init(p),a=reserve(l);l.close();now+=4001;const recovered=reopen(p);
  expectCode(()=>recovered.markDispatchIntent(a.id),'quota');expect(recovered.summary().pools[0]!.reservedMicros).toBe(100000);
  expectCode(()=>reserve(recovered),'duplicate');
 });
 it('allows the paired Standard/Pro burst and rejects the third shared request in a rolling second',()=>{
  const p=path();let now=10000;vi.spyOn(Date,'now').mockImplementation(()=>now);const a=init(p,zoomConfig(50000)),b=reopen(p);
  const first=reserve(a,'run-1',0,'zoom',50000),second=reserve(b,'run-1',0,'zoom-pro',50000),third=reserve(a,'run-1',1,'zoom',50000);
  a.markDispatchIntent(first.id);expect(b.markDispatchIntent(second.id).state).toBe('dispatch_intent');
  expectCode(()=>a.markDispatchIntent(third.id),'rate-limit');now+=999;expectCode(()=>a.markDispatchIntent(third.id),'rate-limit');now+=1;expect(a.markDispatchIntent(third.id).state).toBe('dispatch_intent');
  expect(b.summary().pools[0]!.lastDispatchAtMs).toBe(now);
 });
 it('enforces the shared fixed campaign cap across independent run IDs',()=>{
  const p=path(),l=init(p,zoomConfig(250000));for(let i=0;i<20;i++)reserve(l,`run-${i}`,0,i%2?'zoom-pro':'zoom',250000);
  expectCode(()=>reserve(l,'run-21',0,'zoom',250000),'budget');expect(l.summary().pools[0]!.reservedMicros).toBe(5000000);
  expect(reopen(p).summary().attempts).toBe(20);
 });
 it('cannot invent verified bounds, use zero/smaller bounds, enable Jev implicitly or raise approved Zoom caps',()=>{
  const p=path(),l=init(p);expectCode(()=>l.reserveAttempt({runId:'r',tick:0,provider:'jev',inputHash,costBoundMicros:1}),'quota');
  expectCode(()=>reserve(l,'r',0,'zoom',0),'invalid');expectCode(()=>reserve(l,'r',0,'zoom',1),'invalid');
  expectCode(()=>reserve(l,'r',120),'invalid');
  const bad=zoomConfig();bad.pools[0]!.perRunCapMicros=250001;expect(()=>init(path(),bad)).toThrow();
  const absent=zoomConfig();absent.verifiedCostBounds={};const noBound=init(path(),absent);expectCode(()=>reserve(noBound),'quota');
 });
 it('persists a sanitized result only for its original provider/intent and on-time deadline',()=>{
  const p=path();let now=10000;vi.spyOn(Date,'now').mockImplementation(()=>now);const l=init(p),a=reserve(l);
  expectCode(()=>l.finishAttempt(a.id,{status:'success',result:{provider:'zoom',action:'WAIT',status:'success',latencyMs:1}}),'invalid');
  l.markDispatchIntent(a.id);expectCode(()=>l.finishAttempt(a.id,{status:'success',result:{provider:'jev',action:'WAIT',status:'success',latencyMs:1}}),'invalid');
  now+=4001;expectCode(()=>l.finishAttempt(a.id,{status:'success',result:{provider:'zoom',action:'WAIT',status:'success',latencyMs:1}}),'invalid');
  l.finishAttempt(a.id,{status:'uncertain'});expect(l.summary().pools[0]!.reservedMicros).toBe(100000);
 });
 it('fails immediately on database writer contention without reserving/dispatching',()=>{
  const p=path(),l=init(p),raw=new DatabaseSync(join(p,'ledger.sqlite'));raw.exec('BEGIN IMMEDIATE');
  try{const start=performance.now();expectCode(()=>reserve(l),'invalid');expect(performance.now()-start).toBeLessThan(250);}finally{raw.exec('ROLLBACK');raw.close();}
  expect(l.summary().attempts).toBe(0);
 });
 it('fails closed on missing/replaced/corrupt ledger and corrupt reservation counters',()=>{
  const p=path(),l=init(p);reserve(l);l.close();const raw=new DatabaseSync(join(p,'ledger.sqlite'));raw.exec('UPDATE pools SET reserved_micros=0');raw.close();expect(()=>reopen(p)).toThrow();
  const q=path(),existing=init(q);rmSync(join(q,'ledger.sqlite'));expectCode(()=>reserve(existing),'invalid');expect(()=>reopen(q)).toThrow();expect(existsSync(join(q,'ledger.sqlite'))).toBe(false);
  const r=path();mkdirSync(r,{mode:0o700});writeFileSync(join(r,'ledger.sqlite'),'corrupt',{mode:0o600});expect(()=>reopen(r)).toThrow();
  const link=path();symlinkSync(p,link);expect(()=>reopen(link)).toThrow();
 });
 it('serializes concurrent independent-worker reservations without overspending a generic explicitly configured pool',async()=>{
  const p=path();const c:LedgerConfig={schemaVersion:'provider-ledger-1',campaignId:'explicit-test-jev-campaign',configurationHash:configHash,pools:[{id:'jev-test',providers:['jev'],perRunCapMicros:3,campaignCapMicros:3}],verifiedCostBounds:{jev:{costBoundMicros:1,evidenceId:'fixture-only verified bound; no actual Jev spend'}}};const l=init(p,c);
  const moduleUrl=new URL('../packages/providers/src/ledger.ts',import.meta.url).href;
  const source=`const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {register}=await import('tsx/esm/api');register();const {openLedger}=await import(workerData.url);for(let n=0;n<100;n++){let l;try{l=openLedger(workerData.path,{campaignId:'explicit-test-jev-campaign',configurationHash:workerData.hash});l.reserveAttempt({runId:'r',tick:workerData.tick,provider:'jev',inputHash:workerData.input,costBoundMicros:1});l.close();parentPort.postMessage('reserved');return;}catch(e){try{l?.close();}catch{}if(e.code==='budget'){parentPort.postMessage('budget');return;}if(n===99){parentPort.postMessage('failed');return;}await new Promise(r=>setTimeout(r,5));}}})().catch(()=>parentPort.postMessage('failed'));`;
  const results=await Promise.all(Array.from({length:6},(_,tick)=>new Promise<string>((resolve,reject)=>{const worker=new Worker(source,{eval:true,workerData:{url:moduleUrl,path:p,hash:configHash,input:inputHash,tick}});worker.once('message',resolve);worker.once('error',reject);})));expect(results.filter(r=>r==='reserved')).toHaveLength(3);expect(results.filter(r=>r==='budget')).toHaveLength(3);
  expect(l.summary().pools[0]!.reservedMicros).toBe(3);expect(l.summary().attempts).toBe(3);
 },10000);
});


describe('explicit campaign budget amendment',()=>{
 const jevConfig=():LedgerConfig=>({...zoomConfig(),pools:[...zoomConfig().pools,{id:'jev-separate',providers:['jev'],perRunCapMicros:3000,campaignCapMicros:3000}],verifiedCostBounds:{...zoomConfig().verifiedCostBounds,jev:{costBoundMicros:2753,evidenceId:'test-jev-bound'}}});
 it('preserves prior attempts and counters, rejects stale handles, and audits the approved increase',()=>{
  const directory=path(),old=jevConfig(),l=init(directory,old),stale=reopen(directory);
  const a=l.reserveAttempt({runId:'smoke',tick:0,provider:'jev',inputHash,costBoundMicros:2753});l.markDispatchIntent(a.id);l.finishAttempt(a.id,{status:'uncertain'});
  const next=structuredClone(old);next.configurationHash='c'.repeat(64);next.pools[1]!.perRunCapMicros=340000;next.pools[1]!.campaignCapMicros=340000;
  l.amendBudget(next,'test-approval');expect(()=>stale.summary()).toThrow('configuration changed');expect(()=>reopen(directory)).toThrow();
  const updated=openLedger(directory,next);handles.push(updated);
  expect(updated.lookupAttempt({runId:'smoke',tick:0,provider:'jev'})).toEqual({...a,state:'uncertain',dispatchAtMs:expect.any(Number),finishedAtMs:expect.any(Number)});
  expect(updated.summary()).toMatchObject({attempts:1,pools:expect.arrayContaining([{id:'jev-separate',reservedMicros:2753,capMicros:340000,lastDispatchAtMs:expect.any(Number)}])});
  for(let tick=0;tick<120;tick++)updated.reserveAttempt({runId:'comparison',tick,provider:'jev',inputHash,costBoundMicros:2753});
  expect(updated.summary().pools.find(p=>p.id==='jev-separate')!.reservedMicros).toBe(333113);
  const db=new DatabaseSync(join(directory,'ledger.sqlite'));expect(db.prepare('SELECT approval_reference FROM budget_amendments').get()?.approval_reference).toBe('test-approval');db.close();
 });
 it('rejects changed charge bounds or reduced caps without touching the ledger',()=>{
  const directory=path(),old=jevConfig(),l=init(directory,old),before=l.summary();
  const next=structuredClone(old);next.configurationHash='c'.repeat(64);next.verifiedCostBounds.jev!.costBoundMicros=1;
  expect(()=>l.amendBudget(next,'approval')).toThrow('request bounds');next.verifiedCostBounds.jev!.costBoundMicros=2753;next.pools[1]!.campaignCapMicros=2999;next.pools[1]!.perRunCapMicros=2999;
  expect(()=>l.amendBudget(next,'approval')).toThrow('lower caps');expect(l.summary()).toEqual(before);
 });
});
