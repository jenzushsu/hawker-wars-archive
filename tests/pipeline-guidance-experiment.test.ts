import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {DecisionInputSchema,type DecisionInput} from '../packages/shared/src/index.ts';
import {buildRequest} from '../packages/providers/src/wire.ts';
import {pipelineGuidance,buildPipelineGuidanceRequest} from '../packages/providers/src/pipeline-guidance-experiment.ts';
const inputs:DecisionInput[]=JSON.parse(readFileSync('manifests/pipeline-validation-inputs.json','utf8')).map((v:unknown)=>DecisionInputSchema.parse(v));
it.each(inputs)('preserves state/choices and shares bounded guidance at tick $tick',input=>{
 const before=JSON.stringify(input),instructions=[];
 for(const p of ['jev','zoom','zoom-pro'] as const){
  const base=buildRequest(p,input,'jev-1.13.0'),treatment=buildPipelineGuidanceRequest(p,input,'jev-1.13.0');
  const q=p==='jev'?(treatment.body.questions as any).action:(treatment.body.questions as any)[0];
  const old=p==='jev'?(base.body.questions as any).action:(base.body.questions as any)[0];
  expect(q.instructions.startsWith(old.instructions+'\n')).toBe(true);instructions.push(q.instructions);
  expect(Buffer.byteLength(JSON.stringify(treatment.body))).toBeLessThanOrEqual(8192);
  q.instructions=old.instructions;expect(treatment).toEqual(base);
 }
 expect(new Set(instructions).size).toBe(1);expect(JSON.stringify(input)).toBe(before);
});
it('distinguishes existing work, recoverable stockout and too-late replenishment',()=>{
 const at=(tick:number)=>pipelineGuidance(inputs.find((i:any)=>i.tick===tick));
 expect(at(58)).toContain('already cooking and is due at tick 59');expect(at(58)).toContain('ready at tick 73');
 expect(at(73)).toContain('ready at tick 88, leaving 32 decision ticks');
 expect(at(109)).toContain('cannot be cooked and served before closing');expect(at(109)).toContain('200 cents per portion');
 expect(at(109)).not.toContain('This does not mean later customers stop arriving');
});
