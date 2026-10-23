import { beforeAll, describe, expect, it } from 'vitest';
import { runEpisode } from '../scripts/offline-episode.js';
import {
  createEpisodeReport,exportEpisodeJson,loadEpisodeJson,exportEpisodeCsv,loadEpisodeCsv,
  exportEpisodeJsonl,loadEpisodeJsonl,type EpisodeExportInput,
} from '../packages/benchmark/src/exports.js';

const episodeId='34801eca-7cd6-4c23-a116-8aee7db040ae';
const provenance={sourceRevision:null,sourceTreeHash:'1'.repeat(64),dependencyLockHash:'2'.repeat(64)};
let input:EpisodeExportInput,json:string,csv:string,jsonl:string;
beforeAll(()=>{
 const episode=runEpisode({seed:7,scenario:'bus',metadata:{secret:'should-never-export',token:'example-private-token'}});
 input={...episode,episodeId,mode:'replay',stockoutTicks:episode.metrics.stockoutTicks,sourceProvenance:provenance};
 json=exportEpisodeJson(input);csv=exportEpisodeCsv(input);jsonl=exportEpisodeJsonl(input);
});
function mutateLine(text:string,line:number,mutation:(value:Record<string,unknown>)=>void):string{
 const lines=text.trimEnd().split('\n'),record=JSON.parse(lines[line]!) as Record<string,unknown>;mutation(record);lines[line]=JSON.stringify(record);return lines.join('\n')+'\n';
}

describe('P2-B public episode report exports',()=>{
 it('recomputes financial/game score instead of trusting saved score or metrics',()=>{
  const poisoned={...input,score:{profitCents:999999},metrics:{profitCents:999999}};
  const report=createEpisodeReport(poisoned);
  expect(report.metrics.profitCents).toBe(input.finalState.cashCents+200*input.finalState.rawPortions-28400);
  expect(report.metrics.profitCents).not.toBe(999999);
  expect(report.metrics.utilityPoints).toBe(report.metrics.profitCents-100*report.finalState.totals.abandoned-5*report.finalState.totals.waitMinutes-50*report.finalState.totals.wasted);
 });
 it('records precise units, offline classification and exact source/config identities',()=>{
  const report=loadEpisodeJson(json);
  expect(report.units).toEqual({gameCurrency:'SGD',profit:'cents',utility:'points',wait:'game-minutes',satisfaction:'0-100'});
  expect(report.sourceProvenance).toEqual(provenance);expect(report.hashes.configurationHash).toBe(input.configurationHash);
  expect(report).toMatchObject({mode:'replay',classification:'offline-development'});
 });
 it('round-trips JSON and CSV through independent score recomputation',()=>{
  expect(loadEpisodeCsv(csv)).toEqual(loadEpisodeJson(json));
  expect(csv.split('\r\n')[0]).toContain('profitCents,utilityPoints');
  expect(csv).toContain('""profitCents""');
 });
 it('does not leak evaluator seeds, private customer IDs, secrets or raw metadata in any public format',()=>{
  for(const text of [json,csv,jsonl]){
   expect(text).not.toContain('should-never-export');expect(text).not.toContain('example-private-token');
   expect(text).not.toContain('demand-1|7|');expect(text).not.toContain('seed-7');expect(text).not.toContain('"seed"');
  }
  expect(loadEpisodeJson(json).resolutions.every(r=>r.customerId.startsWith('customer-'))).toBe(true);
 });
 it('rejects altered JSON scores, unknown private fields and mismatched resolutions',()=>{
  const score=JSON.parse(json);score.metrics.profitCents++;expect(()=>loadEpisodeJson(JSON.stringify(score))).toThrow(/recomputed/);
  const leak=JSON.parse(json);leak.apiKey='secret';expect(()=>loadEpisodeJson(JSON.stringify(leak))).toThrow();
  const waits=JSON.parse(json);waits.resolutions[0].waitMinutes++;expect(()=>loadEpisodeJson(JSON.stringify(waits))).toThrow();
 });
 it('rejects incomplete traces and malformed source identities at export',()=>{
  expect(()=>createEpisodeReport({...input,trace:input.trace.slice(0,119)})).toThrow(/120/);
  expect(()=>createEpisodeReport({...input,sourceProvenance:{...provenance,sourceRevision:'=HYPERLINK("bad")'}})).toThrow();
 });
 it('rejects malformed/truncated or duplicate-row CSV and tampered headline scores',()=>{
  expect(()=>loadEpisodeCsv(csv.slice(0,-5))).toThrow();
  expect(()=>loadEpisodeCsv(csv+csv.split('\r\n')[1]+'\r\n')).toThrow(/exactly one/);
  expect(()=>loadEpisodeCsv(csv.replace(',profitCents,',',wrong,'))).toThrow();
  const report=loadEpisodeJson(json);
  expect(()=>loadEpisodeCsv(csv.replace(`,${report.metrics.profitCents},${report.metrics.utilityPoints},`,`,999999,${report.metrics.utilityPoints},`))).toThrow(/headline/);
 });
});

describe('typed complete JSONL dataset',()=>{
 it('reloads all 120 decisions, customer resolutions and terminal record',()=>{
  const loaded=loadEpisodeJsonl(jsonl);
  expect(loaded.decisions).toHaveLength(120);expect(loaded.recordCount).toBe(123+loaded.report.resolutions.length);
  expect(loaded.report).toEqual(loadEpisodeJson(json));expect(loaded.decisions[119]!.tick).toBe(119);
 });
 it('rejects a truncated line, missing trailer, blank line and malformed line with line number',()=>{
  expect(()=>loadEpisodeJsonl(jsonl.slice(0,-1))).toThrow(/newline/);
  expect(()=>loadEpisodeJsonl(jsonl.trimEnd().split('\n').slice(0,-1).join('\n')+'\n')).toThrow();
  expect(()=>loadEpisodeJsonl('\n'+jsonl)).toThrow(/line 1/);
  const lines=jsonl.split('\n');lines[4]='{bad';expect(()=>loadEpisodeJsonl(lines.join('\n'))).toThrow(/line 5/);
 });
 it('rejects duplicate/out-of-order decisions and type-inconsistent ticks',()=>{
  const lines=jsonl.trimEnd().split('\n');lines[2]=lines[1]!;expect(()=>loadEpisodeJsonl(lines.join('\n')+'\n')).toThrow(/duplicate|out-of-order/);
  expect(()=>loadEpisodeJsonl(mutateLine(jsonl,1,r=>{r.tick='0';}))).toThrow(/line 2/);
 });
 it('rejects mismatched local history, bogus attribution and private observation fields',()=>{
  expect(()=>loadEpisodeJsonl(mutateLine(jsonl,8,r=>{(r.observation as {recentActions:unknown[]}).recentActions=[];}))).toThrow(/history/);
  expect(()=>loadEpisodeJsonl(mutateLine(jsonl,1,r=>{r.origin='mock';}))).toThrow(/line 2/);
  expect(()=>loadEpisodeJsonl(mutateLine(jsonl,1,r=>{(r.observation as Record<string,unknown>).seed=7;}))).toThrow(/line 2/);
 });
 it('rejects altered completion counts/checksum and altered public provenance',()=>{
  const last=jsonl.trimEnd().split('\n').length-1;
  expect(()=>loadEpisodeJsonl(mutateLine(jsonl,last,r=>{r.recordCount=2;}))).toThrow(/counts/);
  expect(()=>loadEpisodeJsonl(mutateLine(jsonl,last,r=>{r.sha256='0'.repeat(64);}))).toThrow(/checksum/);
  expect(()=>loadEpisodeJsonl(mutateLine(jsonl,0,r=>{((r.report as Record<string,unknown>).sourceProvenance as Record<string,unknown>).sourceTreeHash='3'.repeat(64);}))).toThrow(/checksum/);
 });
 it('round-trips an explicitly labeled mixed mock episode',()=>{
  const episode=runEpisode({seed:1,scenario:'rain',policy:'mixed'});
  const mixed={...episode,episodeId,mode:'offline' as const,stockoutTicks:episode.metrics.stockoutTicks,sourceProvenance:provenance};
  const loaded=loadEpisodeJsonl(exportEpisodeJsonl(mixed));
  expect(loaded.report.policy).toBe('mixed');expect(loaded.report.decisionSummary.mock).toBeGreaterThan(0);expect(loaded.report.decisionSummary.networkCalls).toBe(0);
 });
});

import { generateStaticCandidates } from '../packages/benchmark/src/static-tasks.js';
import { evaluateDataset } from '../packages/benchmark/src/static-dataset.js';
import { exportStaticDatasetJsonl,loadStaticDatasetJsonl } from '../packages/benchmark/src/exports.js';

describe('static task JSONL exact dataset format',()=>{
 const dataset=evaluateDataset(generateStaticCandidates({seeds:[2000],behaviorPolicies:['rules']}),{maxStates:2000,maxBranches:2000});
 const text=exportStaticDatasetJsonl(dataset);
 it('round-trips typed exact labels, counts and rational strings without number coercion',()=>{
  const loaded=loadStaticDatasetJsonl(text);
  expect(loaded).toEqual(dataset);expect(loaded.records.length).toBeGreaterThan(0);
  for(const record of loaded.records)for(const value of record.oracle.actionValues){
   expect(typeof value.expectedFinalUtility.numerator).toBe('string');expect(typeof value.expectedFinalUtility.denominator).toBe('string');
  }
  expect(JSON.parse(text.split('\n')[0]!).visibility).toBe('evaluator-private');
 });
 it('rejects malformed/truncated/static header type drift',()=>{
  expect(()=>loadStaticDatasetJsonl(text.slice(0,-1))).toThrow(/newline/);
  expect(()=>loadStaticDatasetJsonl(text.trimEnd().split('\n').slice(0,-1).join('\n')+'\n')).toThrow();
  expect(()=>loadStaticDatasetJsonl(mutateLine(text,0,r=>{r.visibility='public';}))).toThrow(/line 1/);
  expect(()=>loadStaticDatasetJsonl(mutateLine(text,1,r=>{((r.record as {oracle:{actionValues:{expectedFinalUtility:{numerator:unknown}}[]}}).oracle.actionValues[0]!).expectedFinalUtility.numerator=1;}))).toThrow(/line 2/);
 });
 it('rejects changed task IDs and incomplete trailer counts',()=>{
  expect(()=>loadStaticDatasetJsonl(mutateLine(text,1,r=>{r.taskId='different';}))).toThrow(/mismatched/);
  const last=text.trimEnd().split('\n').length-1;
  expect(()=>loadStaticDatasetJsonl(mutateLine(text,last,r=>{r.taskCount=999;}))).toThrow(/count/);
 });
});
