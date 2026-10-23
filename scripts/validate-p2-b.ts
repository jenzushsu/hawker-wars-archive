import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configurationHash} from './config-snapshot.js';
import {recordEpisode} from '../packages/replay/src/record.js';
import {readEpisodeArchive,writeEpisodeArchive} from '../packages/replay/src/store.js';
import {replayArchive} from '../packages/replay/src/replay.js';
import {createEpisodeReport,exportEpisodeJson,exportEpisodeCsv,exportEpisodeJsonl,loadEpisodeJson,loadEpisodeCsv,loadEpisodeJsonl,exportStaticDatasetJsonl,loadStaticDatasetJsonl} from '../packages/benchmark/src/exports.js';
import {generateStaticCandidates,STATIC_TASK_MANIFEST} from '../packages/benchmark/src/static-tasks.js';
import {evaluateDataset,freezeStaticDataset,loadStaticDataset,staticManifestHash} from '../packages/benchmark/src/static-dataset.js';
import type {DemandScenario} from '../packages/simulation/src/demand.js';

const root=mkdtempSync(join(tmpdir(),'hawker-p2b-'));
const savedFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Provider/network dispatch forbidden in P2-B validation');};
try{
 let archives=0,replays=0,reloadedReports=0;
 const reference=JSON.parse(readFileSync(new URL('../fixtures/reference/rules-development-1.json',import.meta.url),'utf8')) as {scenarios:{seed:number;scenario:string;finalHash:string;traceHash:string}[]};
 for(const seed of [0,1,7]){
  for(const scenario of ['clean','bus','rain','supplier-delay'] as DemandScenario[]){
   for(const policy of ['rules','mixed'] as const){
    const archive=recordEpisode({seed,scenario,policy,snapshotEvery:30});
    const dir=join(root,`${seed}-${scenario}-${policy}`);writeEpisodeArchive(dir,archive);
    const loaded=readEpisodeArchive(dir,{expectedConfigurationHash:configurationHash});
    const replay=replayArchive(loaded,{configurationHash});replays++;
    for(const snapshotSequence of [60,120]){
     const resumed=replayArchive(loaded,{configurationHash,snapshotSequence});replays++;
     assert.equal(resumed.finalHash,replay.finalHash);assert.equal(resumed.traceHash,replay.traceHash);assert.deepEqual(resumed.metrics,replay.metrics);
    }
    assert.equal(replay.trace.length,120);assert.equal(replay.networkCalls,0);
    if(seed===0&&policy==='rules'){
      const expected=reference.scenarios.find(r=>r.scenario===scenario)!;assert.ok(expected);assert.equal(replay.finalHash,expected.finalHash);assert.equal(replay.traceHash,expected.traceHash);
    }
    const expectedReport=createEpisodeReport(replay);
    assert.deepEqual(loadEpisodeJson(exportEpisodeJson(replay)),expectedReport);reloadedReports++;
    assert.deepEqual(loadEpisodeCsv(exportEpisodeCsv(replay)),expectedReport);reloadedReports++;
    const jsonl=loadEpisodeJsonl(exportEpisodeJsonl(replay));assert.deepEqual(jsonl.report,expectedReport);assert.equal(jsonl.decisions.length,120);reloadedReports++;
    archives++;
   }
  }
  console.log(JSON.stringify({stage:'disk-replay-and-export',seed,archives,replays,reloadedReports,networkCalls:0}));
 }
 const manifest=JSON.parse(readFileSync(new URL('../manifests/static-task-1.json',import.meta.url),'utf8')) as {manifest:unknown;manifestHash:string};
 assert.deepEqual(manifest.manifest,STATIC_TASK_MANIFEST);assert.equal(manifest.manifestHash,staticManifestHash());
 const dataset=evaluateDataset(generateStaticCandidates({split:'development'}));
 assert.deepEqual(loadStaticDataset(freezeStaticDataset(dataset)),dataset);assert.deepEqual(loadStaticDatasetJsonl(exportStaticDatasetJsonl(dataset)),dataset);
 assert.deepEqual(loadStaticDataset(readFileSync(new URL('../fixtures/static/development-1.json',import.meta.url),'utf8')),dataset,'Frozen default static dataset differs');
 assert.deepEqual(loadStaticDatasetJsonl(readFileSync(new URL('../fixtures/static/development-1.jsonl',import.meta.url),'utf8')),dataset,'Frozen default JSONL dataset differs');
 assert.ok(dataset.records.length>0,'Zero exact tasks cannot validate the oracle dataset workflow');
 console.log(JSON.stringify({gate:'P2-B',status:'passed',archivesWrittenRead:archives,replayExecutions:replays,reportReloads:reloadedReports,staticDatasetCounts:dataset.counts,staticSolverLimits:dataset.solverLimits,staticDatasetHash:dataset.datasetHash,heldOutCasesEvaluated:0,networkCalls:0,recordedActionReplayVerified:true}));
}finally{globalThis.fetch=savedFetch;rmSync(root,{recursive:true,force:true});}
