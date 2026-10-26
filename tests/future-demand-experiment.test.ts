import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {DecisionInputSchema} from '../packages/shared/src/index.ts';
import {buildTick63TimelineRequest} from '../packages/providers/src/timeline-experiment.ts';
import {buildTick63FutureDemandRequest} from '../packages/providers/src/future-demand-experiment.ts';
const input=()=>DecisionInputSchema.parse(JSON.parse(readFileSync('manifests/tick63-input.json','utf8')));
it('adds identical current/future-demand guidance while preserving the timeline, context and choices',()=>{
 const value=input(),before=JSON.stringify(value),instructions=[];
 expect(value.observation.queue.every(c=>c.deadlineTick<78)).toBe(true);
 for(const provider of ['jev','zoom','zoom-pro'] as const){
  const base=buildTick63TimelineRequest(provider,value,'jev-1.13.0'),treatment=buildTick63FutureDemandRequest(provider,value,'jev-1.13.0');
  const q=provider==='jev'?(treatment.body.questions as any).action:(treatment.body.questions as any)[0];
  const old=provider==='jev'?(base.body.questions as any).action:(base.body.questions as any)[0];
  expect(q.instructions.startsWith(old.instructions+'\n')).toBe(true);
  expect(q.instructions).toContain('cannot save them');expect(q.instructions).toContain('Future arrivals are uncertain');
  instructions.push(q.instructions);
  expect(Buffer.byteLength(JSON.stringify(treatment.body))).toBeLessThanOrEqual(8192);
  q.instructions=old.instructions;expect(treatment).toEqual(base);
 }
 expect(new Set(instructions).size).toBe(1);expect(JSON.stringify(value)).toBe(before);
});
it('fails closed for an observation without the captured queue',()=>{
 const value=input();value.observation.queue=[];value.observation.totals.arrivals-=4;
 expect(()=>buildTick63FutureDemandRequest('zoom',value)).toThrow('expiring queue');
});
