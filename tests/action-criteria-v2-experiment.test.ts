import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {DecisionInputSchema,type DecisionInput} from '../packages/shared/src/index.ts';
import {getLegalActions} from '../packages/simulation/src/legality.ts';
import {actionCriteriaV2Instructions as instructions,buildActionCriteriaV2Request as build} from '../packages/providers/src/action-criteria-v2-experiment.ts';
import {buildRequest} from '../packages/providers/src/wire.ts';
const rows=JSON.parse(readFileSync('docs/deployment/evidence/criteria-comparison/result.json','utf8')).decisions;
const at=(tick:number)=>DecisionInputSchema.parse(rows[tick].input);
function legal(i:DecisionInput){i.legalActions=getLegalActions(i.observation);i.observation.legalActions=i.legalActions;return i;}
it('explains the exact 86/87 timing and equality-at-deadline boundary',()=>{
 expect(instructions(at(86))).toContain('finishes at tick 91');expect(instructions(at(87))).toContain('finishes at tick 92');
 expect(instructions(at(86))).toContain('delivery at 88, then choosing COOK, would finish at 93');
 const i=at(86);i.observation.queue[0]!.deadlineTick=91;i.observation.queue[0]!.patience=8;expect(instructions(i)).toContain('4 of 5 queued customers expire by tick 91');
 expect(instructions(i)).toContain('background work progresses during any action');
});
it.each(['busy','raw','capacity','closing'] as const)('does not propose currently illegal cooking: %s',kind=>{
 const i=at(kind==='busy'?78:kind==='raw'?68:kind==='closing'?117:0);
 if(kind==='capacity'){i.observation.rawPortions=12;i.observation.readyBatches[0]!.quantity=30;}
 expect(instructions(legal(i))).toContain('COOK is not currently legal');expect(instructions(i)).not.toContain('COOK now uses');
});
it('handles no queue and a delivery too late to cook',()=>{
 const i=at(22);expect(instructions(legal(i))).toContain('0 of 0 queued');
 const late=at(113);late.observation.pendingRestock={quantity:20,dueTick:119,delayApplied:false};late.observation.cashCents-=4000;late.observation.cumulativePurchasesCents+=4000;late.observation.totals.purchasedPortions+=20;late.observation.totals.restockOrders++; 
 expect(instructions(legal(late))).toContain('too late to serve before closing');
});
it('shares instructions across providers and preserves context/choices/model',()=>{
 const input=at(86),before=JSON.stringify(input),texts=[];
 for(const p of ['jev','zoom','zoom-pro'] as const){
  const base=buildRequest(p,input,'jev-1.13.0'),candidate=build(p,input,'jev-1.13.0');
  const q=p==='jev'?(candidate.body.questions as any).action:(candidate.body.questions as any)[0],old=p==='jev'?(base.body.questions as any).action:(base.body.questions as any)[0];
  texts.push(q.instructions);q.instructions=old.instructions;expect(candidate).toEqual(base);
 }
 expect(new Set(texts).size).toBe(1);expect(JSON.stringify(input)).toBe(before);
});
