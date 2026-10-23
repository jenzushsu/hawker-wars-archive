import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderAdapter } from '../packages/providers/src/adapter.js';
import { ProviderRuntimeSchema } from '../packages/providers/src/activation.js';
import { initializeLedger, openLedger, type Ledger } from '../packages/providers/src/ledger.js';
import { createInitialFrame, prepareTick } from '../packages/simulation/src/engine.js';
import { decisionInput } from '../packages/simulation/src/observation.js';
import { readProjectJson, configurationHash } from '../scripts/config-snapshot.js';

const roots: string[]=[];
const ledgers: Ledger[]=[];
const secret='test-only-jev-credential';
afterEach(()=>{for(const ledger of ledgers.splice(0))ledger.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function setup(headers: Record<string,string>, bodyId?: string) {
  const root=mkdtempSync(join(tmpdir(),'hawker-jev-metadata-'));roots.push(root);
  const directory=join(root,'ledger');
  const config=ProviderRuntimeSchema.parse(readProjectJson('manifests/provider-runtime.json'));
  config.jevSpendApproval={perRunCapMicros:3000,campaignCapMicros:3000,approvalReference:'TEST ONLY: fake-fetch test, no real spend'};
  config.providers.jev.model='jev-1.13.0';
  config.providers.jev.maximumRequestCost={micros:2753,currency:'USD',evidenceUrl:'https://example.test/mock-billing',checkedAt:'2026-10-23T00:00:00Z',maxRequestBytes:65536};
  const ledger=initializeLedger(directory,{schemaVersion:'provider-ledger-1',campaignId:config.campaignId,configurationHash,
    pools:[{id:'jev-test-only',providers:['jev'],perRunCapMicros:3000,campaignCapMicros:3000}],
    verifiedCostBounds:{jev:{costBoundMicros:2753,evidenceId:'TEST ONLY'}}});ledgers.push(ledger);
  const input=decisionInput(prepareTick(createInitialFrame(),{arrivals:[]}).state,'76af5727-7871-4ea3-89be-16cf4a459dde');
  const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({model:'jev-1.13.0',answers:{action:{type:'choice',choice:input.legalActions[0]}},usage:{input_tokens:100,output_tokens:1},...(bodyId?{request_id:bodyId}:{})}),{headers}));
  const adapter=createProviderAdapter({provider:'jev',config,ledger,mode:'smoke',fetch:fetcher,credential:()=>secret});
  return {adapter,input,ledger,directory,config,fetcher};
}

describe('Jev documented HTTP response metadata',()=>{
  it('uses x-typesafe-request-id and preserves it across durable recovery without redispatch',async()=>{
    const f=setup({'x-typesafe-request-id':'jev-request-20261023'});
    const original=await f.adapter.decideTurn(f.input);
    expect(original.origin).toBe('provider');
    expect(original.result.requestId).toBe('jev-request-20261023');
    const reopened=openLedger(f.directory,{campaignId:f.config.campaignId,configurationHash});ledgers.push(reopened);
    const recovered=await createProviderAdapter({provider:'jev',config:f.config,ledger:reopened,mode:'smoke',fetch:f.fetcher,credential:()=>secret}).decideTurn(f.input);
    expect(recovered.origin).toBe('recovered');expect(recovered.result).toEqual(original.result);expect(f.fetcher).toHaveBeenCalledTimes(1);
    const request=f.fetcher.mock.calls[0]![1]!;
    expect(new Headers(request.headers).has('TypeSafe-Danger-Zone-Long-Context')).toBe(false);
    expect(Object.keys(JSON.parse(String(request.body)).questions)).toEqual(['action']);
  });
  it.each([
    ['malformed header',{'x-typesafe-request-id':'not an identifier'},undefined],
    ['credential reflection',{'x-typesafe-request-id':secret},undefined],
    ['conflicting body ID',{'x-typesafe-request-id':'header-id'},'different-body-id'],
  ] as const)('rejects %s while retaining the reservation',async(_name,headers,bodyId)=>{
    const f=setup(headers,bodyId);const turn=await f.adapter.decideTurn(f.input);
    expect(turn.result.fallbackReason).toBe('invalid');expect(JSON.stringify(turn)).not.toContain(secret);
    expect(f.ledger.summary().pools[0]!.reservedMicros).toBe(2753);
    const again=await f.adapter.decideTurn(f.input);expect(again.attemptCount).toBe(0);expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not invent an ID when the documented header and body metadata are absent',async()=>{
    const f=setup({});const turn=await f.adapter.decideTurn(f.input);
    expect(turn.origin).toBe('provider');expect(turn.result.requestId).toBeUndefined();
  });
  it('accepts matching header/body IDs and rejects a second paid reservation at the proposed one-smoke cap',async()=>{
    const f=setup({'x-typesafe-request-id':'same-id'},'same-id');
    expect((await f.adapter.decideTurn(f.input)).result.requestId).toBe('same-id');
    const next=structuredClone(f.input);next.roundId='912ad54a-b89b-4ddf-8b0c-7d75980ece54';
    expect((await f.adapter.decideTurn(next)).result.fallbackReason).toBe('budget');
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
});
