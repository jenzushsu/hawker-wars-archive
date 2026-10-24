import { describe, expect, it, vi } from 'vitest';
import { createMultiRoundInput, runMultiTick, MULTI_POLICIES, type MultiControllers, type MultiRecovery } from '../packages/live/src/multi-worker.ts';
import { multiProviderBlockers } from '../packages/live/src/multi-runtime.ts';
import { ProviderRuntimeSchema, activationBlockers } from '../packages/providers/src/activation.ts';
import { readProjectJson } from '../scripts/config-snapshot.ts';
import { chooseRules } from '../packages/decisions/src/rules.ts';
import { runEpisode } from '../scripts/offline-episode.ts';
import type { DecisionInput } from '../packages/shared/src/schemas.ts';
import type { LiveTurn } from '../packages/providers/src/adapter.ts';
import type { LiveCommitInput, LiveStore } from '../packages/live/src/store.ts';
import type { RulesWorkerStore } from '../packages/live/src/worker.ts';
const roundId='11111111-1111-4111-8111-111111111111',ownerId='22222222-2222-4222-8222-222222222222',providerConfigurationHash='a'.repeat(64);
const options={roundId,ownerId,providerConfigurationHash};
type Record=Awaited<ReturnType<LiveStore['getRecovery']>>;
function memory(saved?:Record){
 const input=createMultiRoundInput(roundId,7,providerConfigurationHash);
 let record:Record=saved??{schemaVersion:'live-recovery-1',round_id:roundId,classification:'exhibition',policy_ids:[...MULTI_POLICIES],status:'running',control_state:'active',control_revision:0,tick:-1,sequence:0,configuration_hash:input.configurationHash,schedule_hash:input.scheduleHash,recovery:input.recovery};
 let fence=0;const commits:LiveCommitInput[]=[];
 const store={
  getRoundStatus:vi.fn(async()=>{const {recovery:_,schemaVersion:__,...status}=record;return {...status,schemaVersion:'live-round-status-1' as const,ready:true};}),
  acquireLease:vi.fn(async()=>({fence:++fence,expires_at:'2026-10-25T12:00:30Z'})),
  renewLease:vi.fn(async(x:{fence:number})=>({fence:x.fence,expires_at:'2026-10-25T12:00:30Z'})),releaseLease:vi.fn(async()=>true),
  getRecovery:vi.fn(async()=>structuredClone(record)),
  commitTick:vi.fn(async(c:LiveCommitInput)=>{if(c.tick!==record.tick+1||c.expectedSequence!==record.sequence)throw new Error('conflict');commits.push(structuredClone(c));record={...record,tick:c.tick,sequence:c.tick+1,status:c.tick===120?'completed':'running',recovery:structuredClone(c.recovery)};return {round_id:roundId,tick:c.tick,sequence:c.tick+1,replayed:false};}),
 } satisfies RulesWorkerStore;
 return {store,commits,saved:()=>structuredClone(record)};
}
function controllers():MultiControllers{
 const controller=(provider:'jev'|'zoom'|'zoom-pro')=>({decideTurn:vi.fn(async(input:DecisionInput):Promise<LiveTurn>=>({mode:'live',origin:'provider',attemptedProvider:provider,attemptCount:1,diagnostic:null,result:{provider,action:chooseRules(input.observation,input.legalActions).action,status:'success',latencyMs:1}}))});
 return {jev:controller('jev'),zoom:controller('zoom'),'zoom-pro':controller('zoom-pro')};
}
describe('atomic multi-policy comparison worker',()=>{
 it('creates a private clean four-policy round, with explicit provider identity and voting disabled',()=>{
  expect(createMultiRoundInput(roundId,7,providerConfigurationHash)).toMatchObject({policyIds:[...MULTI_POLICIES],published:false,recovery:{workerVersion:'multi-policy-worker-1',votingEnabled:false,providerConfigurationHash}});
  expect(()=>createMultiRoundInput(roundId,100,providerConfigurationHash)).toThrow('input');
 });
 it('dispatches providers concurrently and commits four independent states together',async()=>{
  const f=memory(),c=controllers();let entered=0;let release!:()=>void;const barrier=new Promise<void>(r=>release=r);
  for(const provider of ['jev','zoom','zoom-pro'] as const){const original=c[provider].decideTurn;c[provider].decideTurn=async input=>{entered++;if(entered===3)release();await barrier;return original(input);};}
  await runMultiTick(f.store,options,c);expect(entered).toBe(3);expect(f.commits).toHaveLength(1);expect(f.commits[0]!.snapshot.policies.map(p=>p.policy_id)).toEqual(MULTI_POLICIES);
  expect(f.commits[0]!.decisions.map(d=>d.source)).toEqual(['rules','model','model','model']);expect(f.store.renewLease).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(f.commits[0]!.snapshot)).not.toMatch(/seed|recovery|requestId|credential|owner/);
 });
 it('replays recorded actions after process replacement and completes without terminal model calls',async()=>{
  let f=memory();const c=controllers();
  for(let tick=0;tick<=120;tick++){if(tick===21||tick===87)f=memory(f.saved());await expect(runMultiTick(f.store,options,c)).resolves.toMatchObject({tick,sequence:tick+1});}
  const expected=runEpisode({seed:7,policy:'rules',roundId});const recovery=f.saved().recovery as MultiRecovery;
  for(const p of recovery.policies){expect(p.stateHash).toBe(expected.finalHash);expect(p.actions).toHaveLength(120);}
  // Identical policies must see identical observations and receive identical scores.
  const inputs=vi.mocked(c.jev.decideTurn).mock.calls;
  for(const id of ['zoom','zoom-pro'] as const)expect(vi.mocked(c[id].decideTurn).mock.calls).toEqual(inputs);
  const scores=f.commits.at(-1)!.snapshot.policies.map(({policy_id,...score})=>score);
  for(const score of scores)expect(score).toEqual(scores[0]);
  expect(f.commits.at(-1)!.decisions).toEqual([]);const calls=vi.mocked(c.jev.decideTurn).mock.calls.length;
  expect(await runMultiTick(f.store,options,c)).toMatchObject({status:'completed'});expect(vi.mocked(c.jev.decideTurn).mock.calls).toHaveLength(calls);
 },60000);
 it('attributes invalid, illegal and failed requests to deterministic rules fallbacks',async()=>{
  const f=memory(),c=controllers();
  vi.mocked(c.zoom.decideTurn).mockResolvedValueOnce({mode:'live',origin:'provider',attemptedProvider:'zoom',attemptCount:1,diagnostic:null,result:{provider:'zoom',action:'COOK',status:'success',latencyMs:1}});
  await runMultiTick(f.store,options,c);
  vi.mocked(c.jev.decideTurn).mockRejectedValueOnce(new Error('credential-canary'));
  vi.mocked(c.zoom.decideTurn).mockResolvedValueOnce({mode:'live',origin:'provider',attemptedProvider:'zoom',attemptCount:1,diagnostic:null,result:{provider:'zoom',action:'COOK',status:'success',latencyMs:1}});
  vi.mocked(c['zoom-pro'].decideTurn).mockResolvedValueOnce(null as unknown as LiveTurn);
  await runMultiTick(f.store,options,c);
  expect(f.commits[1]!.decisions.map(d=>d.fallback_reason)).toEqual([null,'network','illegal','invalid']);
  expect(JSON.stringify(f.commits)).not.toContain('credential-canary');
 });
 it.each(['configuration','schedule','frame','action','order'] as const)('rejects %s recovery corruption before dispatch',async(kind)=>{
  const original=memory(),c=controllers();await runMultiTick(original.store,options,c);const saved=original.saved(),r=saved.recovery as MultiRecovery;
  if(kind==='configuration')r.providerConfigurationHash='b'.repeat(64);
  if(kind==='schedule')r.schedule.seed=8;
  if(kind==='frame')r.policies[1]!.frame.state.cashCents++;
  if(kind==='action')r.policies[1]!.actions[0]={action:'WAIT',source:'model',fallbackReason:null};
  if(kind==='order')r.policies.reverse();
  const fresh=controllers();await expect(runMultiTick(memory(saved).store,options,fresh)).rejects.toMatchObject({code:'recovery'});expect(fresh.jev.decideTurn).not.toHaveBeenCalled();
 });
 it('renews the fence before dispatch and prevents a mixed commit after control invalidation',async()=>{
  const f=memory(),c=controllers();f.store.renewLease.mockRejectedValueOnce(new Error('stale'));await expect(runMultiTick(f.store,options,c)).rejects.toMatchObject({code:'store'});expect(c.jev.decideTurn).not.toHaveBeenCalled();
  f.store.renewLease.mockResolvedValueOnce({fence:2,expires_at:'2026-10-25T12:00:30Z'}).mockRejectedValueOnce(new Error('paused'));
  await expect(runMultiTick(f.store,options,c)).rejects.toMatchObject({code:'store'});expect(f.commits).toEqual([]);
 });
 it('recovers an acknowledged-lost commit without repeating the committed provider boundary',async()=>{
  const f=memory(),c=controllers(),commit=f.store.commitTick.getMockImplementation()!;
  f.store.commitTick.mockImplementationOnce(async value=>{await commit(value);throw new Error('lost acknowledgement');});
  await expect(runMultiTick(f.store,options,c)).rejects.toMatchObject({code:'store'});await runMultiTick(f.store,options,c);
  expect(vi.mocked(c.jev.decideTurn).mock.calls.map(([input])=>input.tick)).toEqual([0,1]);expect(f.commits.map(x=>x.tick)).toEqual([0,1]);
 });
 it.each(['paused','stopped'] as const)('does not dispatch while %s',async control_state=>{
  const original=memory();const saved={...original.saved(),control_state};const f=memory(saved),c=controllers();
  expect(await runMultiTick(f.store,options,c)).toMatchObject({status:control_state});expect(f.store.acquireLease).not.toHaveBeenCalled();expect(c.jev.decideTurn).not.toHaveBeenCalled();
 });
 it('requires campaign scope and keeps missing Zoom billing evidence closed',()=>{
  const config=ProviderRuntimeSchema.parse(readProjectJson('manifests/provider-runtime.json'));
  config.jevSpendApproval!.scope='smoke';
  config.providers.zoom.smoke=null;config.providers['zoom-pro'].smoke=null;
  expect(activationBlockers(config,'jev','live')).toContain('jev-live-campaign-spend-unapproved');
  expect(multiProviderBlockers(config,{TYPESAFE_API_KEY:'test',ZOOM_AI_SERVICES_API_KEY:'test'})).toEqual(expect.arrayContaining(['jev:jev-live-campaign-spend-unapproved','zoom:maximum-request-charge-unverified','zoom-pro:credentialed-smoke-pending']));
 });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeLedger, openLedger, type Ledger } from '../packages/providers/src/ledger.ts';
import { createProviderAdapter } from '../packages/providers/src/adapter.ts';
import { makeLedgerConfig } from '../scripts/provider-config.ts';

async function withAdapters(operation:(get:()=>MultiControllers,reopen:()=>void,fetcher:ReturnType<typeof vi.fn<typeof fetch>>,ledger:()=>Ledger)=>Promise<void>,expensive=false){
 const root=mkdtempSync(join(tmpdir(),'multi-ledger-test-')),directory=join(root,'campaign');
 const config=ProviderRuntimeSchema.parse(readProjectJson('manifests/provider-runtime.json'));
 config.jevSpendApproval={perRunCapMicros:3000,campaignCapMicros:3000,approvalReference:'test-only-no-network',scope:'campaign'};
 for(const p of ['jev','zoom','zoom-pro'] as const){config.providers[p].maximumRequestCost={micros:p!=='jev'&&expensive?250000:100,currency:'USD',evidenceUrl:'https://example.test/test-only',checkedAt:'2026-10-25T00:00:00Z',maxRequestBytes:65536};config.providers[p].smoke={requestId:'test-only',requestedModel:config.providers[p].model!,returnedModel:config.providers[p].model!,checkedAt:'2026-10-25T00:00:00Z'};}
 const expected=makeLedgerConfig(config);let ledger=initializeLedger(directory,expected);
 const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{const body=JSON.parse(String(init!.body));const context=JSON.parse(body.state??body.input);const action=context.legalActions[0];return new Response(JSON.stringify({model:body.model,request_id:'test-only-response',answers:body.state?{action:{type:'choice',choice:action}}:[{name:'action',type:'choice',choice:action}]}));});
 const get=():MultiControllers=>({jev:createProviderAdapter({provider:'jev',config,ledger,fetch:fetcher,credential:()=> 'test-only-key'}),zoom:createProviderAdapter({provider:'zoom',config,ledger,fetch:fetcher,credential:()=> 'test-only-key'}),'zoom-pro':createProviderAdapter({provider:'zoom-pro',config,ledger,fetch:fetcher,credential:()=> 'test-only-key'})});
 try{await operation(get,()=>{ledger.close();ledger=openLedger(directory,expected);},fetcher,()=>ledger);}finally{ledger.close();rmSync(root,{recursive:true,force:true});}
}
describe('multi-policy durable adapter integration (mock transport only)',()=>{
 it('reuses persisted successful responses after a failed tick commit and process restart',async()=>withAdapters(async(get,reopen,fetcher,ledger)=>{
  const f=memory();f.store.commitTick.mockRejectedValueOnce(new Error('no commit'));
  await expect(runMultiTick(f.store,options,get())).rejects.toMatchObject({code:'store'});expect(fetcher).toHaveBeenCalledTimes(3);expect(ledger().summary().attempts).toBe(3);
  reopen();await runMultiTick(f.store,options,get());expect(fetcher).toHaveBeenCalledTimes(3);expect(f.commits[0]!.decisions.map(d=>d.source)).toEqual(['rules','model','model','model']);
 }));
 it('retains uncertain dispatch reservations and never resends after restart',async()=>withAdapters(async(get,reopen,fetcher,ledger)=>{
  fetcher.mockImplementation(async()=>{throw new Error('ambiguous transport');});const f=memory();f.store.commitTick.mockRejectedValueOnce(new Error('no commit'));
  await expect(runMultiTick(f.store,options,get())).rejects.toMatchObject({code:'store'});const reserved=ledger().summary();reopen();await runMultiTick(f.store,options,get());
  expect(fetcher).toHaveBeenCalledTimes(3);expect(ledger().summary()).toEqual(reserved);expect(f.commits[0]!.decisions.slice(1).map(d=>d.fallback_reason)).toEqual(['uncertain','uncertain','uncertain']);
 }));
 it('enforces the shared Zoom run cap when both models dispatch concurrently',async()=>withAdapters(async(get,_reopen,fetcher,ledger)=>{
  const f=memory();await runMultiTick(f.store,options,get());expect(fetcher).toHaveBeenCalledTimes(2);expect(f.commits[0]!.decisions.find(d=>d.policy_id==='zoom-pro')).toMatchObject({source:'rules',fallback_reason:'budget'});expect(ledger().summary().pools.find(p=>p.id==='zoom-shared')?.reservedMicros).toBe(250000);
 },true));
});
