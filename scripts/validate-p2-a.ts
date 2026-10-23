import assert from 'node:assert/strict';
import {validateEngineFixtures} from './validate-engine-fixtures.js';
import { runEpisode } from './offline-episode.js';
import { referenceScenarios,verifyDevelopmentReference } from './p2-reference.js';
import { TRIAL_CONFIG } from '../packages/shared/src/config.js';

const savedFetch=globalThis.fetch;
globalThis.fetch=()=>{throw new Error('Network dispatch forbidden in offline validation');};
try {
  const fixtures=validateEngineFixtures();
  const reference=verifyDevelopmentReference();
  let completed=0,mixedCompleted=0;
  const first=new Map<string,string>();
  for(let pass=0;pass<2;pass++){
    for(const scenario of referenceScenarios){
      for(const seed of TRIAL_CONFIG.developmentSeeds){
        const result=runEpisode({seed,scenario,metadata:{pass,wallClockMs:Date.now()}});
        assert.equal(result.completed,true);assert.equal(result.trace.length,120);assert.equal(result.networkCalls,0);assert.equal(result.finalState.phase,'closed');
        const summary=JSON.stringify({actions:result.trace.map(t=>t.decision.appliedAction),preparedHashes:result.trace.map(t=>t.preparedHash),hashes:result.trace.map(t=>t.hash),finalHash:result.finalHash,traceHash:result.traceHash,score:result.score,metrics:result.metrics});
        const key=`${seed}:${scenario}`;
        if(pass===0)first.set(key,summary);else assert.equal(summary,first.get(key),`Nondeterministic ${key}`);
        completed++;
      }
      console.log(JSON.stringify({stage:'development-rules',pass:pass+1,scenario,completed,networkCalls:0}));
    }
  }
  const actions=new Set<string>();
  for(const scenario of referenceScenarios){
    for(let seed=0;seed<10;seed++){
      const a=runEpisode({seed,scenario,policy:'mixed'}),b=runEpisode({seed,scenario,policy:'mixed',metadata:{interleavingProbe:true}});
      assert.equal(a.traceHash,b.traceHash);assert.deepEqual(a.metrics,b.metrics);
      for(const turn of a.trace)actions.add(turn.decision.appliedAction);
      mixedCompleted+=2;
    }
  }
  assert.deepEqual([...actions].sort(),['COOK','PROMOTE','RESTOCK','SERVE','WAIT']);
  console.log(JSON.stringify({gate:'P2-A',status:'passed',engineFixtureCasesExecuted:fixtures.cases,engineFixtureExpectationsExecuted:fixtures.expectations,rulesEpisodeExecutions:completed,uniqueDevelopmentRulesCases:first.size,mixedEpisodeExecutions:mixedCompleted,turnsPerEpisode:120,referenceCases:reference.scenarios.length,allActionsCovered:[...actions].sort(),sourceTreeHash:reference.sourceIdentity.sourceTreeHash,networkCalls:0,heldOutSeedsUsed:false,durableReplayVerified:false}));
}finally{globalThis.fetch=savedFetch;}
