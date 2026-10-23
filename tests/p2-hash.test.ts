import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInitialFrame } from '../packages/simulation/src/engine.js';
import { canonicalState,stateHash } from '../packages/simulation/src/hash.js';
const golden=JSON.parse(readFileSync(new URL('../fixtures/reference/state-hash-vector.json',import.meta.url),'utf8')) as {configurationHash:string;scheduleHash:string;canonical:string;sha256:string};
describe('independently authored canonical simulator hash',()=>{
 it('matches the explicit Python opening-envelope golden hash',()=>{
  expect(stateHash({frame:createInitialFrame(),scheduleHash:golden.scheduleHash,scenario:'clean',configurationHash:golden.configurationHash,recentActions:[]})).toBe(golden.sha256);
  expect(canonicalState(JSON.parse(golden.canonical) as unknown)).toBe(golden.canonical);
 });
 it('rejects noncanonical values rather than erasing or rounding them',()=>{
  for(const value of [0.1,-0,NaN,Infinity,undefined,Number.MAX_SAFE_INTEGER+1])expect(()=>canonicalState({value})).toThrow();
  expect(()=>canonicalState(new Date())).toThrow();
 });
 it('retains semantic array order while normalizing object insertion order',()=>{
  expect(canonicalState({z:2,a:1})).toBe(canonicalState({a:1,z:2}));
  expect(canonicalState({queue:[1,2]})).not.toBe(canonicalState({queue:[2,1]}));
 });
});
