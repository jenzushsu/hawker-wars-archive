import {describe,it,expect} from 'vitest';
import {runJevVersionComparison} from '../scripts/jev-version-comparison.ts';
import type {DecisionInput} from '../packages/shared/src/index.ts';
import type {LiveTurn} from '../packages/providers/src/adapter.ts';
const roundId='11111111-1111-4111-8111-111111111111';
const turn=(input:DecisionInput,action:DecisionInput['legalActions'][number]):LiveTurn=>({mode:'live',origin:input.legalActions.length===1?'forced_wait':'provider',attemptedProvider:input.legalActions.length===1?null:'jev',attemptCount:input.legalActions.length===1?0:1,result:{provider:input.legalActions.length===1?'rules':'jev',status:'success',action,modelVersion:input.legalActions.length===1?'rules-1':'jev-1.14.0',latencyMs:0},diagnostic:null});
describe('raw Jev version comparison',()=>{
 it('preserves WAIT with an empty pipeline through all 120 ticks without guard intervention',async()=>{
  const report=await runJevVersionComparison({roundId,seed:23,model:'jev-1.14.0',decide:async input=>turn(input,input.tick<63?(input.legalActions.includes('SERVE')?'SERVE':input.legalActions.includes('COOK')?'COOK':'WAIT'):'WAIT')});
  expect(report.decisions).toHaveLength(120);expect(report.guardEnabled).toBe(false);
  expect(report.decisions.slice(63).every(d=>d.executedAction==='WAIT'&&d.turn.result.action==='WAIT')).toBe(true);
  expect(report.decisions.some(d=>d.input.observation.rawPortions===0&&d.input.observation.cooking===null&&d.input.observation.pendingRestock===null&&d.input.observation.readyBatches.length===0&&d.input.legalActions.includes('RESTOCK')&&d.executedAction==='WAIT')).toBe(true);
 });
 it('rejects a returned model mismatch before advancing',async()=>{
  await expect(runJevVersionComparison({roundId,seed:23,model:'jev-1.14.0',decide:async input=>{const t=turn(input,'WAIT');t.result.modelVersion='jev-1.13.0';return t;}})).rejects.toThrow('Unexpected model/origin');
 });
});
