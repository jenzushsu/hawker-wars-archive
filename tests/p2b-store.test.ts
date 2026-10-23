import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEpisode } from '../packages/replay/src/record.js';
import { canonicalArchive, type EpisodeArchive } from '../packages/replay/src/schema.js';
import { archiveRecordHash, publicSnapshot, readEpisodeArchive, writeEpisodeArchive } from '../packages/replay/src/store.js';
import { configurationHash } from '../scripts/config-snapshot.js';

const temporary:string[]=[];
function temp(){const p=mkdtempSync(join(tmpdir(),'hawker-replay-store-'));temporary.push(p);return p;}
function target(){return join(temp(),'episode');}
let archive:EpisodeArchive;
beforeAll(()=>{archive=recordEpisode({seed:0,scenario:'supplier-delay',policy:'rules',snapshotEvery:30});});
afterEach(()=>{for(const p of temporary.splice(0))rmSync(p,{recursive:true,force:true});});
const digest=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
function updateDescriptor(directory:string,key:string,text:string):void{
 const path=join(directory,'manifest.json'),m=JSON.parse(readFileSync(path,'utf8'));
 writeFileSync(join(directory,m.files[key].name),text);
 m.files[key].bytes=Buffer.byteLength(text);m.files[key].sha256=digest(text);
 writeFileSync(path,`${canonicalArchive(m)}\n`);
}

describe('file-backed immutable episode store',()=>{
 it('round-trips full stored schedule, decisions and snapshots through private checked files',()=>{
  const path=target();writeEpisodeArchive(path,archive);
  const restored=readEpisodeArchive(path,{expectedConfigurationHash:configurationHash});
  expect(canonicalArchive(restored)).toBe(canonicalArchive(archive));
  expect(restored.header.schedule.ticks).toHaveLength(120);expect(restored.turns).toHaveLength(120);
  expect(restored.terminal.frame.stage).toBe('closed');expect(restored.snapshots.map(s=>s.sequence)).toEqual([0,30,60,90,120]);
  expect(lstatSync(path).mode&0o777).toBe(0o700);
  for(const name of readdirSync(path))expect(lstatSync(join(path,name)).mode&0o777).toBe(0o600);
 });
 it('publishes a sanitized public snapshot stream with no evaluator schedule, customer identities or source metadata',()=>{
  const path=target();writeEpisodeArchive(path,archive);
  const rows=readFileSync(join(path,'snapshots.public.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  expect(rows.map(row=>row.payload)).toEqual(archive.snapshots.map(publicSnapshot));
  for(const row of rows){expect(Object.keys(row.payload).sort()).toEqual(['abandoned','cashCents','phase','profitCents','queueLength','rawPortions','readyPortions','schemaVersion','sequence','served','tick','utilityPoints','wasted'].sort());}
  const text=JSON.stringify(rows);for(const field of ['privateToPublicIds','seenCustomerIds','sourceIdentity','seed-','TYPESAFE_API_KEY','ZOOM_AI_SERVICES_API_KEY'])expect(text).not.toContain(field);
 });
 it('refuses to overwrite an existing empty directory or a directory containing user data',()=>{
  const path=target();mkdirSync(path);expect(()=>writeEpisodeArchive(path,archive)).toThrow();
  expect(readdirSync(path)).toEqual([]);writeFileSync(join(path,'user.txt'),'preserve');
  expect(()=>writeEpisodeArchive(path,archive)).toThrow();expect(readFileSync(join(path,'user.txt'),'utf8')).toBe('preserve');
 });
 it('does not create a target for invalid or partial episodes',()=>{
  const path=target(),bad=structuredClone(archive);bad.turns.pop();
  expect(()=>writeEpisodeArchive(path,bad)).toThrow();expect(existsSync(path)).toBe(false);
 });
 it('rejects byte corruption and a missing file',()=>{
  const path=target();writeEpisodeArchive(path,archive);
  const turns=join(path,'turns.jsonl');writeFileSync(turns,readFileSync(turns,'utf8').replace('committedHash','committedHush'));
  expect(()=>readEpisodeArchive(path,{expectedConfigurationHash:configurationHash})).toThrow('checksum');
  rmSync(turns);expect(()=>readEpisodeArchive(path,{expectedConfigurationHash:configurationHash})).toThrow('missing or unexpected');
 });
 it('rejects JSONL truncation even when file metadata is recomputed',()=>{
  const path=target();writeEpisodeArchive(path,archive);
  updateDescriptor(path,'turns',readFileSync(join(path,'turns.jsonl'),'utf8').slice(0,-1));
  expect(()=>readEpisodeArchive(path,{expectedConfigurationHash:configurationHash})).toThrow('Truncated JSONL');
 });
 it('rejects duplicate turn sequence even when the entire hash chain is recomputed',()=>{
  const path=target();writeEpisodeArchive(path,archive);
  const lines=readFileSync(join(path,'turns.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  let previous=lines[0].previousRecordHash as string;
  for(const [i,row]of lines.entries()){
   if(i===1){row.sequence=1;row.payload=structuredClone(lines[0].payload);}
   row.previousRecordHash=previous;row.recordHash=archiveRecordHash('turns',row.sequence,previous,row.payload);previous=row.recordHash;
  }
  updateDescriptor(path,'turns',`${lines.map(canonicalArchive).join('\n')}\n`);
  const manifestPath=join(path,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));manifest.lastTurnRecordHash=previous;writeFileSync(manifestPath,`${canonicalArchive(manifest)}\n`);
  expect(()=>readEpisodeArchive(path,{expectedConfigurationHash:configurationHash})).toThrow('sequence');
 });
 it('rejects configuration/version mismatch and unsafe filesystem indirection',()=>{
  const path=target();writeEpisodeArchive(path,archive);
  expect(()=>readEpisodeArchive(path,{expectedConfigurationHash:'f'.repeat(64)})).toThrow('configuration');
  const manifestPath=join(path,'manifest.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));manifest.schemaVersion='episode-store-999';writeFileSync(manifestPath,JSON.stringify(manifest));
  expect(()=>readEpisodeArchive(path,{expectedConfigurationHash:configurationHash})).toThrow();
  const other=target();writeEpisodeArchive(other,archive);const header=join(other,'header.json');rmSync(header);symlinkSync(join(path,'header.json'),header);
  expect(()=>readEpisodeArchive(other,{expectedConfigurationHash:configurationHash})).toThrow();
  const link=join(temp(),'link');symlinkSync(other,link);expect(()=>readEpisodeArchive(link,{expectedConfigurationHash:configurationHash})).toThrow('real directory');
 });
 it('rejects private archive files made broadly readable',()=>{
  const path=target();writeEpisodeArchive(path,archive);chmodSync(join(path,'header.json'),0o644);
  expect(()=>readEpisodeArchive(path,{expectedConfigurationHash:configurationHash})).toThrow('permissions');
 });
});
