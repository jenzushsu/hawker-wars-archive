import {describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readRuntimeConfig,makeLedgerConfig} from '../scripts/provider-config.ts';
import {activationBlockers} from '../packages/providers/src/activation.ts';
import {initializeLedger,openLedger} from '../packages/providers/src/ledger.ts';
import {createProviderAdapter} from '../packages/providers/src/adapter.ts';
import {createInitialFrame,prepareTick} from '../packages/simulation/src/engine.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
const run='d7f7da47-8b31-4465-8cf9-77773683da3f';
function config(){const c=readRuntimeConfig();c.zoomCampaignException={roundId:run,approvalReference:'test-explicit-exception',allocationMicrosPerRequest:1000,maxRequestBytes:8192,priorSmokeAllocations:['docs/providers/zoom-smoke-result.json','docs/providers/zoom-pro-smoke-result.json']};return c;}
function withDir<T>(fn:(directory:string)=>T):T {const root=mkdtempSync(join(tmpdir(),'campaign-exception-'));try{return fn(join(root,'ledger'));}finally{rmSync(root,{recursive:true,force:true});}}
describe('single-round unverified-charge exception',()=>{
 it('keeps verified bounds null and accounts for both prior smokes and the entire allowed run',()=>withDir(directory=>{
  const c=config(),expected=makeLedgerConfig(c),l=initializeLedger(directory,expected);
  try{
   expect(c.providers.zoom.maximumRequestCost).toBeNull();expect(expected.verifiedCostBounds.zoom).toBeUndefined();expect(expected.unverifiedAllocations!.zoom!.costBoundMicros).toBe(1000);
   expect(activationBlockers(c,'zoom','live')).toEqual([]);expect(activationBlockers(c,'zoom','smoke')).toContain('maximum-request-charge-unverified');
   expect(()=>l.reserveAttempt({runId:'unapproved',tick:0,provider:'zoom',inputHash:'a'.repeat(64),costBoundMicros:1000})).toThrow('outside');
   for(let tick=0;tick<120;tick++)for(const provider of ['zoom','zoom-pro'] as const)l.reserveAttempt({runId:run,tick,provider,inputHash:'a'.repeat(64),costBoundMicros:1000});
   expect(l.summary().pools.find(p=>p.id==='zoom-shared')!.reservedMicros).toBe(242000);l.validateStorage();
   expect(()=>l.reserveAttempt({runId:run,tick:0,provider:'zoom',inputHash:'a'.repeat(64),costBoundMicros:1000})).toThrow('already');
  }finally{l.close();}
 }));
 it('stops further requests when reported input-token cost exceeds the shared run cap',()=>withDir(directory=>{
  const l=initializeLedger(directory,makeLedgerConfig(config()));try{const a=l.reserveAttempt({runId:run,tick:0,provider:'zoom',inputHash:'a'.repeat(64),costBoundMicros:1000});l.markDispatchIntent(a.id);l.finishAttempt(a.id,{status:'success',result:{provider:'zoom',action:'COOK',status:'success',latencyMs:1},nativeUsage:{schemaVersion:'provider-native-usage-1',provider:'zoom',inputUnits:10000000,outputUnits:1,unitType:'tokens'}});expect(()=>l.reserveAttempt({runId:run,tick:0,provider:'zoom-pro',inputHash:'a'.repeat(64),costBoundMicros:1000})).toThrow('budget exhausted');}finally{l.close();}
 }));
 it('adds prior allocations once through the audited amendment and preserves existing Jev charges',()=>withDir(directory=>{
  const old=makeLedgerConfig(readRuntimeConfig()),next=makeLedgerConfig(config()),l=initializeLedger(directory,old);
  l.reserveAttempt({runId:'prior-jev-smoke',tick:0,provider:'jev',inputHash:'a'.repeat(64),costBoundMicros:2753});
  l.amendBudget(next,'test-approval');const updated=openLedger(directory,next);
  try{expect(updated.summary()).toMatchObject({attempts:1,pools:expect.arrayContaining([expect.objectContaining({id:'jev-separate',reservedMicros:2753}),expect.objectContaining({id:'zoom-shared',reservedMicros:2000})])});expect(()=>updated.amendBudget({...next,allowedRunId:'another',configurationHash:'b'.repeat(64)},'test')).toThrow('replace approved run');}finally{updated.close();}
 }));
 it('explicitly advances a run without resetting reservations or allowing the previous run',()=>withDir(directory=>{
  const c=config(),old=makeLedgerConfig(c),l=initializeLedger(directory,old);
  l.reserveAttempt({runId:run,tick:0,provider:'jev',inputHash:'a'.repeat(64),costBoundMicros:2753});
  l.reserveAttempt({runId:run,tick:0,provider:'zoom',inputHash:'b'.repeat(64),costBoundMicros:1000});
  c.zoomCampaignException!.roundId='11111111-1111-4111-8111-111111111111';
  c.zoomCampaignException!.approvalReference='test-new-run-approval';
  const next=makeLedgerConfig(c);
  expect(()=>l.amendBudget(next,'test','wrong-run')).toThrow('current');
  expect(()=>l.amendBudget(next,'test')).toThrow('replace approved run');
  l.amendBudget(next,'test-new-run-approval',run);
  const fresh=openLedger(directory,next);
  try {
    expect(fresh.summary().attempts).toBe(2);
    expect(fresh.summary().pools.find(p=>p.id==='zoom-shared')!.reservedMicros).toBe(3000);
    expect(()=>fresh.reserveAttempt({runId:run,tick:1,provider:'jev',inputHash:'c'.repeat(64),costBoundMicros:2753})).toThrow('outside');
    fresh.reserveAttempt({runId:c.zoomCampaignException!.roundId,tick:0,provider:'jev',inputHash:'c'.repeat(64),costBoundMicros:2753});
    expect(fresh.summary().pools.find(p=>p.id==='jev-separate')!.reservedMicros).toBe(5506);
  } finally {fresh.close();}
 }));
 it('dispatches only the approved round and recovers a saved response without a second HTTP request',async()=>{
  const root=mkdtempSync(join(tmpdir(),'campaign-adapter-')),directory=join(root,'ledger'),c=config(),expected=makeLedgerConfig(c);let l=initializeLedger(directory,expected);
  const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({model:'zoom-decisions',request_id:'test-receipt',answers:[{name:'action',type:'choice',choice:'COOK'}],usage:{input_units:1482,output_units:1,unit_type:'tokens'}})));
  const input=decisionInput(prepareTick(createInitialFrame(),{arrivals:[]}).state,run);
  try{
   const adapter=()=>createProviderAdapter({provider:'zoom',config:c,ledger:l,fetch:fetcher,credential:()=> 'test-key'});
   expect((await adapter().decideTurn({...input,roundId:'11111111-1111-4111-8111-111111111111'})).attemptCount).toBe(0);expect(fetcher).not.toHaveBeenCalled();
   expect((await adapter().decideTurn(input)).origin).toBe('provider');l.close();l=openLedger(directory,expected);
   expect((await adapter().decideTurn(input)).origin).toBe('recovered');expect(fetcher).toHaveBeenCalledTimes(1);expect(l.summary().pools.find(p=>p.id==='zoom-shared')!.reservedMicros).toBe(3000);
  }finally{l.close();rmSync(root,{recursive:true,force:true});}
 });
});
