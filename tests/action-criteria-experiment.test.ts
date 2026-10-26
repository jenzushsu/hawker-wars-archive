import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {DecisionInputSchema} from '../packages/shared/src/index.ts';
import {getLegalActions} from '../packages/simulation/src/legality.ts';
import {actionCriteriaInstructions,buildActionCriteriaRequest} from '../packages/providers/src/action-criteria-experiment.ts';
import {buildRequest} from '../packages/providers/src/wire.ts';
const rows=JSON.parse(readFileSync('docs/deployment/evidence/jev114-comparison/result.json','utf8')).decisions;
const at=(tick:number)=>DecisionInputSchema.parse(rows[tick].input);
it('shares criteria without changing observations, actions or model identity',()=>{
 const input=at(59),before=JSON.stringify(input),texts=[];
 for(const p of ['jev','zoom','zoom-pro'] as const){
  const base=buildRequest(p,input,'jev-1.13.0'),candidate=buildActionCriteriaRequest(p,input,'jev-1.13.0');
  const q=p==='jev'?(candidate.body.questions as any).action:(candidate.body.questions as any)[0],old=p==='jev'?(base.body.questions as any).action:(base.body.questions as any)[0];
  texts.push(q.instructions);q.instructions=old.instructions;expect(candidate).toEqual(base);
 }
 expect(new Set(texts).size).toBe(1);expect(JSON.stringify(input)).toBe(before);
});
it('handles empty pipeline and the closing boundary without promising profit',()=>{
 expect(actionCriteriaInstructions(at(59))).toContain('delivery at 69; optimistic earliest new food at 74');
 expect(actionCriteriaInstructions(at(59))).toContain('Remaining service ticks: 46');
 expect(actionCriteriaInstructions(at(109))).toContain('cannot be cooked and served before closing');
 expect(actionCriteriaInstructions(at(110))).toContain('RESTOCK is not currently legal');
});
it('accounts for supplier delay and does not invent legal orders with pending delivery',()=>{
 const i=at(59);i.observation.effects=[{type:'supplier-delay',startsAt:59,endsAt:68}];i.legalActions=getLegalActions(i.observation);i.observation.legalActions=i.legalActions;
 expect(actionCriteriaInstructions(i)).toContain('delivery at 74; optimistic earliest new food at 79');
 expect(actionCriteriaInstructions(at(32))).toContain('RESTOCK is not currently legal');
 expect(actionCriteriaInstructions(at(32))).not.toContain('WAIT leaves the pipeline empty');
});
