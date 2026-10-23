import assert from 'node:assert/strict';
import { runEpisode, type EpisodeOptions } from '../../../scripts/offline-episode.js';
import { sourceIdentity } from '../../../scripts/source-identity.js';
import { configurationHash } from '../../../scripts/config-snapshot.js';
import { CONTRACT_VERSIONS, type Observation } from '../../shared/src/index.js';
import { createInitialFrame,prepareTick,applyAction,advanceTick,settle } from '../../simulation/src/engine.js';
import { createDemandSchedule,arrivalsAt,toEngineArrival,eventAt } from '../../simulation/src/demand.js';
import { stateHash } from '../../simulation/src/hash.js';
import type { CustomerResolution,EngineFrame } from '../../simulation/src/types.js';
import { parseArchive,EpisodeTurnSchema,PrivateSnapshotSchema,type EpisodeArchive,type EpisodeTurn,type PrivateSnapshot } from './schema.js';

/** Capture a local episode; paid/live policy dispatch is not supported. */
export function recordEpisode(options:EpisodeOptions & {snapshotEvery?:number}):EpisodeArchive {
  const every=options.snapshotEvery??20;
  if(!Number.isSafeInteger(every)||every<1||every>120)throw new Error('Snapshot interval must be 1–120');
  const episode=runEpisode(options),schedule=createDemandSchedule(episode.seed,episode.scenario);
  assert.equal(schedule.hash,episode.scheduleHash);
  let frame=createInitialFrame(),recentActions:Observation['recentActions']=[],stockoutTicks=0;
  const initialFrame=structuredClone(frame),resolutions:CustomerResolution[]=[],turns:EpisodeTurn[]=[],snapshots:PrivateSnapshot[]=[];
  const hash=()=>stateHash({frame,scheduleHash:schedule.hash,scenario:schedule.scenario,configurationHash,recentActions});
  const collect=(f:EngineFrame)=>{for(const e of f.events)if(e.type==='customer-resolved')resolutions.push(e);};
  const snapshot=(sequence:number)=>snapshots.push(PrivateSnapshotSchema.parse({schemaVersion:'private-snapshot-1',sequence,frame,recentActions,resolutions,stockoutTicks,stateHash:hash()}));
  snapshot(0);
  for(const turn of episode.trace){
    const tick=turn.tick,p=frame.state.promotion,event=eventAt(schedule,tick),arrivals=arrivalsAt(schedule,tick,!!p&&p.startsAt<=tick&&p.endsAt>=tick).map(toEngineArrival);
    frame=prepareTick(frame,event?{arrivals,event}:{arrivals});collect(frame);
    if(frame.state.queue.length&&frame.state.readyBatches.length===0)stockoutTicks++;
    const preparedEvents=structuredClone(frame.events);assert.equal(hash(),turn.preparedHash);
    frame=applyAction(frame,turn.decision.appliedAction);collect(frame);
    recentActions=[...recentActions,{tick,action:turn.decision.appliedAction}].slice(-5);assert.equal(hash(),turn.hash);
    turns.push(EpisodeTurnSchema.parse({sequence:tick+1,tick,input:turn.input,observation:turn.observation,decision:turn.decision,appliedAction:turn.decision.appliedAction,preparedHash:turn.preparedHash,committedHash:turn.hash,preparedEvents,committedEvents:frame.events}));
    if((tick+1)%every===0||tick===119)snapshot(tick+1);
    frame=advanceTick(frame);
  }
  frame=settle(frame);collect(frame);assert.equal(hash(),episode.finalHash);assert.deepEqual(resolutions,episode.resolutions);
  return parseArchive({schemaVersion:'episode-archive-1',header:{contracts:CONTRACT_VERSIONS,configurationHash,schedule,policy:episode.policy,runId:episode.trace[0]!.input.roundId,sourceIdentity:sourceIdentity(),initialFrame},turns,
    terminal:{sequence:121,frame,recentActions,resolutions,stockoutTicks,score:episode.score,metrics:episode.metrics,finalHash:episode.finalHash,traceHash:episode.traceHash,events:frame.events},snapshots},configurationHash);
}
