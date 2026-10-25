import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {DecisionInputSchema} from '../packages/shared/src/index.js';
import {buildShortPlanRequest} from '../packages/providers/src/short-plan-experiment.js';
const states=JSON.parse(readFileSync('docs/deployment/evidence/prompt-v2/jev-investigation.json','utf8')).capturedStates.map((s:unknown)=>DecisionInputSchema.parse(s));
it.each([57,109])('supplies identical state and complete plan instructions at tick %s',tick=>{
  const input=states.find((s:{tick:number})=>s.tick===tick);
  const requests=(['jev','zoom','zoom-pro'] as const).map(p=>buildShortPlanRequest(p,input,'jev-1.13.0'));
  const j=(requests[0]!.body.questions as any).action;
  for(const r of requests.slice(1)) {
    expect((r.body.questions as any)[0].instructions).toBe(j.instructions);
    expect(r.body.input).toBe(requests[0]!.body.state);
  }
  for(const [label,description] of Object.entries(j.criteria))expect(j.instructions).toContain(`${label}: ${description}`);
  for(const r of requests)expect(Buffer.byteLength(JSON.stringify(r.body))).toBeLessThanOrEqual(8192);
  expect(j.instructions).toContain('Wait for 10 turns');
  expect(j.instructions).toContain('No plan will be executed');
});
it('rejects the pending-delivery control instead of assigning infeasible plans',()=>{
  expect(()=>buildShortPlanRequest('jev',states[0],'jev-1.13.0')).toThrow('empty pipeline');
});
