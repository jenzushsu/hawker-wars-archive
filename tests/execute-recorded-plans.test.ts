import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {executeRecordedPlan} from '../scripts/execute-recorded-plans.ts';
import {createShortPlanExecutor} from '../packages/decisions/src/short-plan.ts';
const rows=JSON.parse(readFileSync('docs/deployment/evidence/prompt-v2/v2-decisions.json','utf8'));
it('reproduces the observed campaign before measuring counterfactual execution',()=>{
  const result=executeRecordedPlan(rows,57,'recorded');
  expect(result.score).toMatchObject({profitCents:10600,utilityPoints:870,provisional:false});
  expect(result.totals).toMatchObject({served:46,abandoned:66});
});
it('executes one complete order, prioritizes serving, and does not silently replan',()=>{
  const result=executeRecordedPlan(rows,57,'RESTOCK');
  expect(result.continuation.restockTicks).toEqual([57]);
  expect(result.continuation.cookTicks).toEqual([67,76]);
  expect(result.totals.served).toBe(66);
  expect(result.score.profitCents).toBe(16600);
  expect(result.trace.filter(t=>t.legalActions.includes('SERVE')).every(t=>t.action==='SERVE')).toBe(true);
  expect(result.trace.filter(t=>t.tick>=85).every(t=>t.action==='WAIT')).toBe(true);
  expect(result.trace.some(t=>t.tick>=85&&t.legalActions.includes('RESTOCK'))).toBe(true);
});
it('waits exactly ten turns before the delayed plan orders and then executes service',()=>{
  const result=executeRecordedPlan(rows,57,'WAIT');
  expect(result.trace.slice(0,10).every(t=>t.action==='WAIT')).toBe(true);
  expect(result.continuation.restockTicks).toEqual([67]);
  expect(result.continuation.cookTicks[0]).toBe(77);
  expect(result.totals.served).toBe(66);
});
it('respects closing legality and confirms the late-state utility tie',()=>{
  const immediate=executeRecordedPlan(rows,109,'RESTOCK'),delayed=executeRecordedPlan(rows,109,'WAIT');
  expect(immediate.continuation.cookTicks).toEqual([]);
  expect(delayed.continuation.restockTicks).toEqual([]);
  expect(immediate.closingRaw).toBe(20);
  expect(delayed.closingRaw).toBe(0);
  expect(immediate.score).toEqual(delayed.score);
});
it('rejects duplicate execution at the same decision boundary',()=>{
  const observation=executeRecordedPlan(rows,57,'RESTOCK').startObservation!;
  const executor=createShortPlanExecutor(57,'RESTOCK');
  expect(executor.decide(observation)).toBe('RESTOCK');
  expect(()=>executor.decide(observation)).toThrow('consecutive');
});
