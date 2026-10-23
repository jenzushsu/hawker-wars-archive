import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { createInitialFrame,prepareTick,applyAction,advanceTick,settle } from '../../simulation/src/engine.js';
import { arrivalsAt,toEngineArrival,eventAt } from '../../simulation/src/demand.js';
import { decisionInput } from '../../simulation/src/observation.js';
import { stateHash,canonicalState } from '../../simulation/src/hash.js';
import { scoreState,episodeMetrics } from '../../simulation/src/scoring.js';
import type { CustomerResolution,EngineFrame } from '../../simulation/src/types.js';
import type { Observation } from '../../shared/src/index.js';
import { parseArchive,PrivateSnapshotSchema,type EpisodeArchive,type PrivateSnapshot } from './schema.js';

/** Replay only saved schedules/actions: no policy module, SDK, random draw or network client is imported. */
export function replayArchive(value:unknown,options:{configurationHash:string;snapshotSequence?:number}) {
  const archive=parseArchive(value,options.configurationHash),{header}=archive,schedule=header.schedule;
  const selected=options.snapshotSequence;
  if(selected!==undefined&&(!Number.isSafeInteger(selected)||!archive.snapshots.some(s=>s.sequence===selected)))throw new Error('Requested committed snapshot does not exist');
  let frame=createInitialFrame(),recentActions:Observation['recentActions']=[],stockoutTicks=0;
  let resolutions:CustomerResolution[]=[];
  const snapshots=new Map(archive.snapshots.map(s=>[s.sequence,s]));
  let snapshotsVerified=0;
  const hash=()=>stateHash({frame,scheduleHash:schedule.hash,scenario:schedule.scenario,configurationHash:header.configurationHash,recentActions});
  const collect=(f:EngineFrame)=>{for(const e of f.events)if(e.type==='customer-resolved')resolutions.push(e);};
  assert.deepEqual(header.initialFrame,frame,'Saved opening differs from frozen initialization');
  const checkSnapshot=(sequence:number)=>{
    const saved=snapshots.get(sequence);if(!saved)return;
    const actual=PrivateSnapshotSchema.parse({schemaVersion:'private-snapshot-1',sequence,frame,recentActions,resolutions,stockoutTicks,stateHash:hash()});
    assert.deepEqual(saved,actual,`Snapshot ${sequence} differs from replayed prefix`);snapshotsVerified++;
    // A seek is permitted only after validating the complete prefix, including diagnostic projections.
    if(selected===sequence){frame=structuredClone(saved.frame);recentActions=structuredClone(saved.recentActions);resolutions=structuredClone(saved.resolutions);stockoutTicks=saved.stockoutTicks;}
  };
  checkSnapshot(0);
  const trace:EpisodeArchive['turns']=[];
  for(const turn of archive.turns){
    const tick=turn.tick;
    if(frame.stage==='committed')frame=advanceTick(frame);
    assert.equal(frame.boundaryTick,tick,'Replay boundary gap');
    const p=frame.state.promotion,event=eventAt(schedule,tick),arrivals=arrivalsAt(schedule,tick,!!p&&p.startsAt<=tick&&p.endsAt>=tick).map(toEngineArrival);
    frame=prepareTick(frame,event?{arrivals,event}:{arrivals});collect(frame);
    const input=decisionInput(frame.state,header.runId,recentActions);
    assert.deepEqual(input,turn.input,`Decision input differs at tick ${tick}`);assert.deepEqual(input.observation,turn.observation);
    assert.equal(hash(),turn.preparedHash,`Prepared state differs at tick ${tick}`);assert.deepEqual(frame.events,turn.preparedEvents,`Preparation events differ at tick ${tick}`);
    if(frame.state.queue.length&&frame.state.readyBatches.length===0)stockoutTicks++;
    frame=applyAction(frame,turn.appliedAction);collect(frame);recentActions=[...recentActions,{tick,action:turn.appliedAction}].slice(-5);
    assert.equal(hash(),turn.committedHash,`Committed state differs at tick ${tick}`);assert.deepEqual(frame.events,turn.committedEvents,`Action events differ at tick ${tick}`);
    trace.push(turn);checkSnapshot(turn.sequence);
  }
  frame=settle(advanceTick(frame));collect(frame);
  const score=scoreState(frame.state,resolutions),metrics=episodeMetrics(frame.state,resolutions,stockoutTicks),finalHash=hash();
  const traceHash=createHash('sha256').update('hawker-wars|offline-trace-1\n').update(canonicalState({scheduleHash:schedule.hash,policy:header.policy,turns:trace.map(t=>({tick:t.tick,action:t.appliedAction,preparedHash:t.preparedHash,hash:t.committedHash})),finalHash})).digest('hex');
  assert.deepEqual(frame,archive.terminal.frame,'Terminal frame differs');assert.deepEqual(frame.events,archive.terminal.events);
  assert.deepEqual(resolutions,archive.terminal.resolutions,'Customer resolutions differ');assert.deepEqual(recentActions,archive.terminal.recentActions);
  assert.equal(stockoutTicks,archive.terminal.stockoutTicks);assert.deepEqual(score,archive.terminal.score,'Stored score differs from recomputation');assert.deepEqual(metrics,archive.terminal.metrics,'Stored metrics differ from recomputation');assert.equal(finalHash,archive.terminal.finalHash);assert.equal(traceHash,archive.terminal.traceHash);
  return {mode:'replay' as const,episodeId:header.runId,policy:header.policy,scenario:schedule.scenario,completed:true as const,finalState:frame.state,resolutions,stockoutTicks,trace,score,metrics,configurationHash:header.configurationHash,scheduleHash:schedule.hash,finalHash,traceHash,
    sourceProvenance:{sourceRevision:null,sourceTreeHash:header.sourceIdentity.sourceTreeHash,dependencyLockHash:header.sourceIdentity.dependencyLockHash},resumedAt:selected??0,snapshotsVerified,networkCalls:0 as const};
}
