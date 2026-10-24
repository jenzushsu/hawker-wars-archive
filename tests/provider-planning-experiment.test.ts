import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {DecisionInputSchema} from '../packages/shared/src/index.js';
import {buildRequest,parseResponse,WireContractError, type WireProvider} from '../packages/providers/src/wire.js';
import {buildPlanningExperimentRequest} from '../packages/providers/src/planning-experiment.js';

const evidence = JSON.parse(readFileSync('docs/deployment/evidence/prompt-v2/jev-investigation.json','utf8'));
const states = evidence.capturedStates.map((s:unknown)=>DecisionInputSchema.parse(s));
describe('captured-state planning experiment',()=>{
  it('contains pending-delivery, early-stockout and late-stockout controls',()=>{
    expect(states.map((s:{tick:number})=>s.tick)).toEqual([26,57,95,109]);
    expect(states[0].observation.pendingRestock).not.toBeNull();
    expect(states[1].legalActions).toEqual(['RESTOCK','WAIT']);
    expect(states[3].observation.remainingMinutes).toBe(11);
  });
  it.each([0,1,2,3])('preserves context and equal instructions at captured state %s',index=>{
    const input = states[index];
    const requests = (['jev','zoom','zoom-pro'] as const).map(provider=>{
      expect(buildPlanningExperimentRequest(provider,input,'baseline','jev-1.13.0')).toEqual(buildRequest(provider,input,'jev-1.13.0'));
      const request = buildPlanningExperimentRequest(provider,input,'planning','jev-1.13.0');
      expect(Buffer.byteLength(JSON.stringify(request.body))).toBeLessThanOrEqual(8192);
      return request;
    });
    const j = (requests[0]!.body.questions as any).action;
    for(const r of requests.slice(1)) {
      expect((r.body.questions as any)[0].instructions).toBe(j.instructions);
      expect(r.body.input).toBe(requests[0]!.body.state);
    }
    for(const [label,description] of Object.entries(j.criteria)) expect(j.instructions).toContain(`${label}: ${description}`);
  });
});
describe('bounded probability diagnostics',()=>{
  function failure(provider:WireProvider, probabilities:unknown) {
    const input = states[1], model = provider === 'jev' ? 'jev-1.13.0' : provider === 'zoom' ? 'zoom-decisions-standard' : 'zoom-decisions-pro';
    const answer = {type:'choice',choice:'RESTOCK',probabilities};
    try {
      parseResponse(provider,input,model,{model,answers:provider==='jev'?{action:answer}:[{name:'action',...answer}]},10);
      throw new Error('Expected rejection');
    } catch(e) { expect(e).toBeInstanceOf(WireContractError); return (e as WireContractError).probabilityDiagnostic; }
  }
  it.each(['jev','zoom','zoom-pro'] as const)('explains rounding without relaxing validation: %s',provider=>{
    expect(failure(provider,provider==='jev'?{RESTOCK:.5,WAIT:.49}:[{value:'RESTOCK',probability:.5},{value:'WAIT',probability:.49}])).toEqual({shapeValid:true,missingLabels:[],unexpectedLabelCount:0,duplicateLabelCount:0,invalidValueCount:0,sum:.99});
  });
  it('reports missing, duplicate, unexpected and invalid values without echoing text',()=>{
    const detail = failure('zoom',[{value:'RESTOCK',probability:1},{value:'RESTOCK',probability:NaN},{value:'secret-label',probability:'secret-value'}]);
    expect(detail).toEqual({shapeValid:true,missingLabels:['WAIT'],unexpectedLabelCount:1,duplicateLabelCount:1,invalidValueCount:2,sum:null});
    expect(JSON.stringify(detail)).not.toContain('secret');
  });
  it.each(['jev','zoom','zoom-pro'] as const)('reports malformed shape consistently: %s',provider=>{
    expect(failure(provider,'secret')).toEqual({shapeValid:false,missingLabels:['RESTOCK','WAIT'],unexpectedLabelCount:0,duplicateLabelCount:0,invalidValueCount:0,sum:null});
  });
});
