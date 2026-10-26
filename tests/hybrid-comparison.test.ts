import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {runHybridComparison,hybridExecution} from '../scripts/hybrid-comparison.ts';
import {chooseRules} from '../packages/decisions/src/rules.ts';
import type {DecisionInput} from '../packages/shared/src/index.ts';
import type {LiveTurn} from '../packages/providers/src/adapter.ts';
const captured=JSON.parse(readFileSync('docs/deployment/evidence/v4-full/decisions.json','utf8')).filter((r:any)=>r.policy==='jev');
it('executes shared recovery and feeds fresh state/executed history to every model for 120 ticks',async()=>{
 const observed:Record<string,DecisionInput[]>={jev:[],zoom:[],'zoom-pro':[]};
 const controller=(provider:'jev'|'zoom'|'zoom-pro')=>async(input:DecisionInput):Promise<LiveTurn>=>{
  observed[provider]!.push(input);
  const action=input.tick<63?captured.find((r:any)=>r.tick===input.tick).action:input.tick===63?'WAIT':chooseRules(input.observation,input.legalActions).action;
  return {mode:'live',origin:input.legalActions.length===1?'forced_wait':'provider',attemptedProvider:input.legalActions.length===1?null:provider,attemptCount:input.legalActions.length===1?0:1,result:{provider,action,status:'success',latencyMs:0},diagnostic:null};
 };
 const r=await runHybridComparison({roundId:'11111111-1111-4111-8111-111111111111',seed:23,controllers:{jev:controller('jev'),zoom:controller('zoom'),'zoom-pro':controller('zoom-pro')}});
 expect(r.decisions).toHaveLength(480);expect(r.results.find(p=>p.policy==='rules')!.score.profitCents).toBe(31100);
 for(const p of ['jev','zoom','zoom-pro']){
  const d=r.decisions.find(d=>d.policy===p&&d.tick===63)!;
  expect(d.modelSelectedAction).toBe('WAIT');expect(d.executedAction).toBe('RESTOCK');expect(d.source).toBe('shared-restock-recovery');expect(d.turn!.result.action).toBe('WAIT');
  expect(observed[p]![64]!.observation.pendingRestock?.dueTick).toBe(73);
  expect(observed[p]![64]!.observation.recentActions.at(-1)).toEqual({tick:63,action:'RESTOCK'});
  expect(r.results.find(row=>row.policy===p)!.score.profitCents).toBe(19600);
 }
 expect(observed.jev).toEqual(observed.zoom);expect(observed.jev).toEqual(observed['zoom-pro']);
});
it('retains fallback attribution and never labels it as a model/guard choice',()=>{
 const input=JSON.parse(readFileSync('manifests/tick63-input.json','utf8'));
 const turn:LiveTurn={mode:'live',origin:'fallback',attemptedProvider:'jev',attemptCount:0,result:{provider:'jev',action:null,status:'fallback',appliedAction:'RESTOCK',fallbackPolicy:'rules-1',fallbackReason:'budget',latencyMs:0},diagnostic:'test-only'};
 expect(hybridExecution(input,turn)).toMatchObject({modelSelectedAction:null,executedAction:'RESTOCK',source:'fallback',intervention:null});
});
