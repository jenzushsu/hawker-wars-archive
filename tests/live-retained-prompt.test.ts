import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import {ProviderRuntimeSchema} from '../packages/providers/src/activation.ts';
import {providerConfigurationHash,liveRequestBuilder,multiControllers} from '../packages/live/src/multi-runtime.ts';
import {buildActionCriteriaRequest} from '../packages/providers/src/action-criteria-experiment.ts';
import {createMultiRoundInput} from '../packages/live/src/multi-worker.ts';
import {createProviderAdapter} from '../packages/providers/src/adapter.ts';
import type {Ledger} from '../packages/providers/src/ledger.ts';
vi.mock('../packages/providers/src/adapter.ts',()=>({createProviderAdapter:vi.fn(()=>({decideTurn:vi.fn(async()=>({result:{status:'success',action:'WAIT'},origin:'provider'}))}))}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
const config=ProviderRuntimeSchema.parse({...JSON.parse(readFileSync('manifests/provider-runtime-live-retained.json','utf8')),zoomCampaignException:JSON.parse(readFileSync('manifests/campaign-exception-live-retained.json','utf8'))});
const input=JSON.parse(readFileSync('manifests/cooking-test-inputs.json','utf8'))[0];
it('uses the retained builder for every live model and preserves its chosen action',async()=>{
 vi.stubEnv('TYPESAFE_API_KEY','test');vi.stubEnv('ZOOM_AI_SERVICES_API_KEY','test');
 const ledger={config:{campaignId:config.campaignId},validateStorage:()=>{},getCostBound:(p:string)=>p==='jev'?2753:1000} as unknown as Ledger;
 const controllers=multiControllers(config,ledger,'action-criteria-prompt-1');
 for(const provider of ['jev','zoom','zoom-pro'] as const){
  const options=vi.mocked(createProviderAdapter).mock.calls.find(([o])=>o.provider===provider)![0];
  expect(options.requestBuilder!(provider,input,'jev-1.13.0')).toEqual(buildActionCriteriaRequest(provider,input,'jev-1.13.0'));
  expect(await controllers[provider].decideTurn(input)).toMatchObject({result:{action:'WAIT'},origin:'provider'});
 }
});
it('binds public four-policy round identity to the retained prompt',()=>{
 const identity=providerConfigurationHash(config,'action-criteria-prompt-1');expect(identity).not.toBe(providerConfigurationHash(config));
 expect(createMultiRoundInput(config.zoomCampaignException!.roundId,23,identity,true)).toMatchObject({published:true,policyIds:['rules','jev','zoom','zoom-pro'],recovery:{providerConfigurationHash:identity,votingEnabled:false}});
});
it('rejects unsupported prompt selectors',()=>{expect(()=>liveRequestBuilder('action-criteria-prompt-2' as any)).toThrow('Unknown live prompt');});
