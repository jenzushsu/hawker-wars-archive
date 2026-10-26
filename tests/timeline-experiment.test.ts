import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {DecisionInputSchema} from '../packages/shared/src/index.ts';
import {buildRequest} from '../packages/providers/src/wire.ts';
import {buildTick63TimelineRequest} from '../packages/providers/src/timeline-experiment.ts';
const input=()=>DecisionInputSchema.parse(JSON.parse(readFileSync('manifests/tick63-input.json','utf8')));
it('changes only shared instructions and keeps the captured context and options intact',()=>{
 const value=input(),before=JSON.stringify(value),instructions=[];
 for(const provider of ['jev','zoom','zoom-pro'] as const){
  const base=buildRequest(provider,value,'jev-1.13.0'),treatment=buildTick63TimelineRequest(provider,value,'jev-1.13.0');
  const q=provider==='jev'?(treatment.body.questions as any).action:(treatment.body.questions as any)[0];
  const old=provider==='jev'?(base.body.questions as any).action:(base.body.questions as any)[0];
  expect(q.instructions).toMatch(new RegExp('^'+old.instructions.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  expect(q.instructions).toContain('tick 78, with 42 decision ticks remaining');
  expect(q.instructions).toContain('not automatic execution');
  expect(q.instructions).toContain('ready at tick 79');
  instructions.push(q.instructions);
  q.instructions=old.instructions;expect(treatment).toEqual(base);
  expect(Buffer.byteLength(JSON.stringify(buildTick63TimelineRequest(provider,value,'jev-1.13.0').body))).toBeLessThanOrEqual(8192);
 }
 expect(new Set(instructions).size).toBe(1);expect(JSON.stringify(value)).toBe(before);
});
it('rejects a different timeline rather than presenting incorrect tick arithmetic',()=>{
 const value=input();value.tick=64;value.observation.tick=64;value.observation.remainingMinutes=56;
 expect(()=>buildTick63TimelineRequest('zoom',value)).toThrow();
});
