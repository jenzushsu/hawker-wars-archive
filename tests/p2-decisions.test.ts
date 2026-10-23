import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DecisionInputSchema, ObservationSchema, type DecisionInput } from '../packages/shared/src/schemas.js';
import { chooseRules, decideOffline, resolveMockOutcome, scriptedMock, type Action, type MockOutcome, type RulesState } from '../packages/decisions/src/index.js';

const initialObservation=JSON.parse(readFileSync(new URL('../fixtures/observation-2-initial.json',import.meta.url),'utf8')) as unknown;
const initialInput=():DecisionInput=>DecisionInputSchema.parse({roundId:'34801eca-7cd6-4c23-a116-8aee7db040ae',tick:0,observation:initialObservation,legalActions:['COOK','RESTOCK','PROMOTE','WAIT']});
const rulesState=(patch:Partial<RulesState>={}):RulesState=>({tick:10,readyBatches:[{id:'batch-0',quantity:5,expiresAt:30}],rawPortions:10,cooking:null,pendingRestock:null,queue:[{id:'customer-8-base-0',arrivalTick:8,patience:3,deadlineTick:11}],...patch});
const allActions:Action[]=['SERVE','COOK','RESTOCK','PROMOTE','WAIT'];
const success=(action:Action='COOK',elapsedMs=1):MockOutcome=>({kind:'response',elapsedMs,response:{provider:'jev',action,status:'success',latencyMs:elapsedMs}});

describe('rules-1 concrete priorities',()=>{
 it('serves an urgent head before a legal cook',()=>expect(chooseRules(rulesState(),allActions)).toEqual({action:'SERVE',rulePriority:1}));
 it('cooks at inclusive R=5 before nonurgent service',()=>expect(chooseRules(rulesState({queue:[{id:'customer-8-base-0',arrivalTick:8,patience:7,deadlineTick:15}]}),allActions)).toEqual({action:'COOK',rulePriority:2}));
 it('restocks at pipeline10 before nonurgent service when R=6',()=>expect(chooseRules(rulesState({readyBatches:[{id:'batch-0',quantity:6,expiresAt:30}],queue:[{id:'customer-8-base-0',arrivalTick:8,patience:7,deadlineTick:15}]}),allActions)).toEqual({action:'RESTOCK',rulePriority:3}));
 it('skips an illegal urgent action and follows the next matching rule',()=>expect(chooseRules(rulesState(),['COOK','RESTOCK','WAIT'])).toEqual({action:'COOK',rulePriority:2}));
 it('excludes prepared inventory from the pipeline test',()=>expect(chooseRules(rulesState({readyBatches:[{id:'batch-0',quantity:20,expiresAt:30}],queue:[]}),allActions)).toEqual({action:'RESTOCK',rulePriority:3}));
 it('cooks a buffer before promotion at R=15 and promotes at16',()=>{
  expect(chooseRules(rulesState({queue:[],rawPortions:25,readyBatches:[{id:'batch-0',quantity:15,expiresAt:30}]}),allActions)).toEqual({action:'COOK',rulePriority:5});
  expect(chooseRules(rulesState({queue:[],rawPortions:25,readyBatches:[{id:'batch-0',quantity:16,expiresAt:30}]}),allActions)).toEqual({action:'PROMOTE',rulePriority:7});
 });
 it('falls through to WAIT and rejects malformed captured action order',()=>{
  expect(chooseRules(rulesState({tick:119,queue:[],readyBatches:[],rawPortions:0}),['WAIT'])).toEqual({action:'WAIT',rulePriority:8});
  expect(()=>chooseRules(rulesState(),['WAIT','SERVE'])).toThrow();
  expect(()=>chooseRules(rulesState({tick:120}),['WAIT'])).toThrow();
 });
 it('does not mutate state or legal actions',()=>{
  const state=rulesState(),before=structuredClone(state),legal=[...allActions];
  chooseRules(state,legal);expect(state).toEqual(before);expect(legal).toEqual(allActions);
 });
});

describe('offline boundary, mock validation and fallback',()=>{
 it('makes the deterministic rules result explicit without a provider attempt',()=>{
  expect(decideOffline(initialInput())).toMatchObject({origin:'rules',mode:'offline',appliedAction:'COOK',appliedPolicy:'rules',rulePriority:5,attemptCount:0});
 });
 it('preserves successful mock attribution and validates the raw result',()=>{
  const mock=scriptedMock([success('RESTOCK',27)]);
  const result=decideOffline(initialInput(),{mode:'mock',provider:'jev',controller:mock.controller});
  expect(mock.callCount).toBe(1);expect(result).toMatchObject({origin:'mock',mode:'offline',appliedAction:'RESTOCK',attemptedProvider:'jev',providerStatus:'success',attemptCount:1,latencyMs:27});
 });
 it.each([
  {name:'invalid enum',outcome:{kind:'response',elapsedMs:1,response:{provider:'jev',action:'DANCE',status:'success',latencyMs:1}},reason:'invalid'},
  {name:'unknown field',outcome:{kind:'response',elapsedMs:1,response:{provider:'jev',action:'COOK',status:'success',latencyMs:1,secret:'no'}},reason:'invalid'},
  {name:'wrong provider',outcome:{kind:'response',elapsedMs:1,response:{provider:'zoom',action:'COOK',status:'success',latencyMs:1}},reason:'invalid'},
  {name:'illegal legal-enum action',outcome:success('SERVE'),reason:'illegal'},
  {name:'late response',outcome:success('COOK',4001),reason:'timeout'},
  {name:'network error',outcome:{kind:'failure',reason:'network',elapsedMs:20},reason:'network'},
  {name:'rate limit',outcome:{kind:'failure',reason:'rate-limit',elapsedMs:20},reason:'rate-limit'},
  {name:'timeout',outcome:{kind:'failure',reason:'timeout',elapsedMs:4000},reason:'timeout'},
  {name:'negative virtual time',outcome:success('COOK',-1),reason:'invalid'},
 ] as const)('$name produces one legal and explicitly attributed fallback',({outcome,reason})=>{
  const mock=scriptedMock([outcome as MockOutcome]);
  const result=decideOffline(initialInput(),{mode:'mock',provider:'jev',controller:mock.controller});
  expect(mock.callCount).toBe(1);expect(result).toMatchObject({origin:'fallback',appliedPolicy:'rules',appliedAction:'COOK',applicationStatus:'fallback',providerStatus:'error',fallbackReason:reason,attemptCount:1,baselineVersion:'rules-1',failurePolicyVersion:'fallback-2'});
 });
 it('accepts response exactly at the bounded deadline and rejects any later response',()=>{
  expect(decideOffline(initialInput(),{mode:'mock',provider:'jev',controller:()=>success('COOK',4000)}).origin).toBe('mock');
  expect(decideOffline(initialInput(),{mode:'mock',provider:'jev',controller:()=>success('COOK',4001)}).fallbackReason).toBe('timeout');
 });
 it('keeps captured data safe from controller mutation before fallback',()=>{
  const input=initialInput(),before=structuredClone(input);
  const result=decideOffline(input,{mode:'mock',provider:'jev',controller:received=>{
   received.legalActions.splice(0);received.observation.rawPortions=0;throw new Error('fake network error');
  }});
  expect(result.appliedAction).toBe('COOK');expect(input).toEqual(before);
 });
 it('forced WAIT bypasses even a controller that would fail',()=>{
  const input=initialInput();input.legalActions=['WAIT'];input.observation.legalActions=['WAIT'];
  let calls=0;const result=decideOffline(input,{mode:'mock',provider:'jev',controller:()=>{calls++;throw new Error('must not call');}});
  expect(calls).toBe(0);expect(result).toMatchObject({origin:'forced_wait',attemptedProvider:null,providerStatus:'not-called',applicationStatus:'forced_wait',attemptCount:0,appliedResult:null});
 });
 it('captures invalid and late provider proposals separately from applied fallback',()=>{
  const state=rulesState();
  const invalid=resolveMockOutcome({state,legalActions:['SERVE','COOK','WAIT'],provider:'jev',outcome:success('PROMOTE',100)});
  expect(invalid).toMatchObject({proposedAction:'PROMOTE',appliedAction:'SERVE',diagnostic:'illegal_action',fallbackReason:'illegal'});
  const late=resolveMockOutcome({state,legalActions:['SERVE','COOK','WAIT'],provider:'jev',outcome:success('COOK',4001)});
  expect(late).toMatchObject({proposedAction:'COOK',appliedAction:'SERVE',diagnostic:'late_response',fallbackReason:'timeout'});
 });
 it('rejects an invalid real decision input rather than weakening its ledger for fixtures',()=>{
  const input=initialInput();input.observation.rawPortions=0;
  expect(()=>decideOffline(input)).toThrow();
 });
 it('accepts a real urgent observation without fixture-only accounting',()=>{
  const input=initialInput();input.tick=2;input.observation=ObservationSchema.parse({...input.observation,tick:2,remainingMinutes:118,queue:[{id:'customer-0-base-0',arrivalTick:0,patience:3,deadlineTick:3}],totals:{...input.observation.totals,arrivals:1},legalActions:allActions});input.legalActions=allActions;
  expect(decideOffline(input).rulePriority).toBe(1);
 });
});
