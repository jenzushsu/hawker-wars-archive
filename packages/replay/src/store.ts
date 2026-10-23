import { createHash, randomUUID } from 'node:crypto';
import {
  constants, openSync, closeSync, readSync, writeFileSync, fsyncSync, fstatSync,
  lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, rmdirSync, readdirSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { HashSchema, NonnegativeIntegerSchema } from '../../shared/src/index.js';
import { scoreState } from '../../simulation/src/scoring.js';
import {
  EpisodeHeaderSchema, EpisodeTerminalSchema, EpisodeTurnSchema, PrivateSnapshotSchema, PublicSnapshotSchema,
  canonicalArchive, parseArchive, type EpisodeArchive, type PrivateSnapshot, type PublicSnapshot,
} from './schema.js';

export const STORE_LIMITS=Object.freeze({fileBytes:32*1024*1024,lineBytes:2*1024*1024,manifestBytes:64*1024,totalBytes:96*1024*1024});
const count=NonnegativeIntegerSchema;
const descriptor=(name:string)=>z.object({name:z.literal(name),bytes:count.refine(n=>n<=STORE_LIMITS.fileBytes),sha256:HashSchema}).strict();
export const StoreManifestSchema=z.object({
 schemaVersion:z.literal('episode-store-1'),archiveVersion:z.literal('episode-archive-1'),complete:z.literal(true),
 configurationHash:HashSchema,turnCount:z.literal(120),snapshotCount:count.refine(n=>n<=121),lastTurnRecordHash:HashSchema,
 files:z.object({header:descriptor('header.json'),turns:descriptor('turns.jsonl'),terminal:descriptor('terminal.json'),privateSnapshots:descriptor('snapshots.private.jsonl'),publicSnapshots:descriptor('snapshots.public.jsonl')}).strict(),
}).strict();
type Descriptor=z.infer<ReturnType<typeof descriptor>>;
const wrapped=z.object({sequence:count,previousRecordHash:HashSchema,recordHash:HashSchema,payload:z.unknown()}).strict();
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function archiveRecordHash(stream:'turns'|'private-snapshots'|'public-snapshots',sequence:number,previousRecordHash:string,payload:unknown):string {
 return createHash('sha256').update(`hawker-wars|${stream}|archive-record-1\n`).update(canonicalArchive({sequence,previousRecordHash,payload})).digest('hex');
}
function encodeRows(stream:'turns'|'private-snapshots'|'public-snapshots',items:readonly {sequence:number}[],initialHash:string):{text:string;lastHash:string} {
 let previousRecordHash=initialHash;
 const rows=items.map(payload=>{
  const recordHash=archiveRecordHash(stream,payload.sequence,previousRecordHash,payload);
  const row=canonicalArchive({sequence:payload.sequence,previousRecordHash,recordHash,payload});
  previousRecordHash=recordHash;
  if(Buffer.byteLength(row)>STORE_LIMITS.lineBytes)throw new Error('Archive record exceeds line size limit');
  return row;
 });
 return {text:rows.length?`${rows.join('\n')}\n`:'',lastHash:previousRecordHash};
}
/** Public projection is an explicit whitelist; private schedule/history/customer IDs never cross it. */
export function publicSnapshot(value:PrivateSnapshot):PublicSnapshot {
 const snapshot=PrivateSnapshotSchema.parse(value),state=snapshot.frame.state,score=scoreState(state);
 return PublicSnapshotSchema.parse({schemaVersion:'public-snapshot-1',sequence:snapshot.sequence,tick:state.tick,phase:snapshot.sequence===0?'waiting':'committed',cashCents:state.cashCents,rawPortions:state.rawPortions,readyPortions:state.readyBatches.reduce((n,b)=>n+b.quantity,0),queueLength:state.queue.length,served:state.totals.served,abandoned:state.totals.abandoned,wasted:state.totals.wasted,profitCents:score.profitCents,utilityPoints:score.utilityPoints});
}
function descriptorFor(name:string,text:string):Descriptor {
 const bytes=Buffer.byteLength(text);
 if(bytes>STORE_LIMITS.fileBytes)throw new Error(`Archive file ${name} exceeds size limit`);
 return {name,bytes,sha256:sha(text)};
}
function writePrivateFile(path:string,text:string):void {
 const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
 try{writeFileSync(fd,text,'utf8');fsyncSync(fd);}finally{closeSync(fd);}
}
function syncDirectory(path:string):void {const fd=openSync(path,constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}}
/** Publishes an immutable complete archive; no existing target or user files are overwritten. */
export function writeEpisodeArchive(targetDirectory:string,value:unknown):{directory:string;manifest:z.infer<typeof StoreManifestSchema>} {
 const archive=parseArchive(value);
 const target=resolve(targetDirectory),parent=dirname(target);
 const header=`${canonicalArchive(archive.header)}\n`,headerHash=sha(header);
 const turns=encodeRows('turns',archive.turns,headerHash);
 const privateSnapshots=encodeRows('private-snapshots',archive.snapshots,headerHash);
 const publicSnapshots=encodeRows('public-snapshots',archive.snapshots.map(publicSnapshot),headerHash);
 const terminal=`${canonicalArchive(archive.terminal)}\n`;
 const contents={header,turns:turns.text,terminal,privateSnapshots:privateSnapshots.text,publicSnapshots:publicSnapshots.text};
 const files={header:descriptorFor('header.json',header),turns:descriptorFor('turns.jsonl',turns.text),terminal:descriptorFor('terminal.json',terminal),privateSnapshots:descriptorFor('snapshots.private.jsonl',privateSnapshots.text),publicSnapshots:descriptorFor('snapshots.public.jsonl',publicSnapshots.text)};
 if(Object.values(files).reduce((n,f)=>n+f.bytes,0)>STORE_LIMITS.totalBytes)throw new Error('Archive exceeds total size limit');
 const manifest=StoreManifestSchema.parse({schemaVersion:'episode-store-1',archiveVersion:'episode-archive-1',complete:true,configurationHash:archive.header.configurationHash,turnCount:120,snapshotCount:archive.snapshots.length,lastTurnRecordHash:turns.lastHash,files});
 let stage:string|undefined,reserved=false,published=false;
 try{
  // mkdir is the exclusive claim. Rename later replaces only this process's empty reservation.
  // Existing user directories (including empty ones) and symlinks fail without modification.
  mkdirSync(target,{mode:0o700});reserved=true;
  stage=mkdtempSync(join(parent,`.${basename(target)}.staging-${randomUUID()}-`));
  for(const key of Object.keys(files)as (keyof typeof files)[])writePrivateFile(join(stage,files[key].name),contents[key]);
  writePrivateFile(join(stage,'manifest.json'),`${canonicalArchive(manifest)}\n`);syncDirectory(stage);
  renameSync(stage,target);published=true;stage=undefined;syncDirectory(parent);
  return {directory:target,manifest};
 }catch(error){
  if(stage)rmSync(stage,{recursive:true,force:true});
  // Remove only our still-empty claim. Never recursively remove a target that someone populated.
  if(reserved&&!published){try{rmdirSync(target);}catch{/* preserve any unexpected contents */}}
  throw error;
 }
}
function readLimited(path:string,maxBytes:number):Buffer {
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=fstatSync(fd);
  if(!stat.isFile()||stat.size>maxBytes)throw new Error('Archive input is not a bounded regular file');
  if((stat.mode&0o077)!==0)throw new Error('Private archive file permissions are too broad');
  const buffer=Buffer.alloc(stat.size+1);let offset=0;
  while(offset<buffer.length){const n=readSync(fd,buffer,offset,buffer.length-offset,null);if(n===0)break;offset+=n;}
  if(offset!==stat.size)throw new Error('Archive file changed size or is truncated during read');
  return buffer.subarray(0,offset);
 }finally{closeSync(fd);}
}
function decodeJson(text:Buffer,label:string):unknown {
 try{return JSON.parse(text.toString('utf8'))as unknown;}catch{throw new Error(`Invalid or truncated archive JSON: ${label}`);}
}
function rows(stream:'turns'|'private-snapshots'|'public-snapshots',text:Buffer,initialHash:string,expectedCount:number):{values:unknown[];lastHash:string} {
 const raw=text.toString('utf8');
 if(raw.length&& !raw.endsWith('\n'))throw new Error('Truncated JSONL record: missing final newline');
 const lines=raw.length?raw.slice(0,-1).split('\n'):[];
 if(lines.length!==expectedCount)throw new Error('Archive record count mismatch');
 const values:unknown[]=[];let previousRecordHash=initialHash,previousSequence=-1;
 for(const [index,line]of lines.entries()){
  if(!line||Buffer.byteLength(line)>STORE_LIMITS.lineBytes)throw new Error('Empty or oversized archive record');
  const row=wrapped.parse(decodeJson(Buffer.from(line),'JSONL record'));
  if(row.previousRecordHash!==previousRecordHash||row.recordHash!==archiveRecordHash(stream,row.sequence,previousRecordHash,row.payload))throw new Error('Archive record checksum chain mismatch');
  if(row.sequence<=previousSequence||(stream==='turns'&&row.sequence!==index+1))throw new Error('Archive sequence gap, reordering or duplicate');
  const payload=stream==='turns'?EpisodeTurnSchema.parse(row.payload):stream==='private-snapshots'?PrivateSnapshotSchema.parse(row.payload):PublicSnapshotSchema.parse(row.payload);
  if(payload.sequence!==row.sequence)throw new Error('Archive record/payload sequence mismatch');
  previousSequence=row.sequence;previousRecordHash=row.recordHash;values.push(payload);
 }
 return {values,lastHash:previousRecordHash};
}
export function readEpisodeArchive(directory:string,options:{expectedConfigurationHash:string}):EpisodeArchive {
 const root=resolve(directory),rootStat=lstatSync(root);
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('Archive path must be a real directory');
 const manifest=StoreManifestSchema.parse(decodeJson(readLimited(join(root,'manifest.json'),STORE_LIMITS.manifestBytes),'manifest'));
 if(manifest.configurationHash!==HashSchema.parse(options.expectedConfigurationHash))throw new Error('Archive configuration hash mismatch');
 const expectedNames=['manifest.json',...Object.values(manifest.files).map(f=>f.name)].sort();
 if(canonicalArchive(readdirSync(root).sort())!==canonicalArchive(expectedNames))throw new Error('Archive contains missing or unexpected files');
 if(Object.values(manifest.files).reduce((n,f)=>n+f.bytes,0)>STORE_LIMITS.totalBytes)throw new Error('Archive exceeds total size limit');
 const blobs={}as Record<keyof typeof manifest.files,Buffer>;
 for(const key of Object.keys(manifest.files)as (keyof typeof manifest.files)[]){
  const d=manifest.files[key],bytes=readLimited(join(root,d.name),STORE_LIMITS.fileBytes);
  if(bytes.length!==d.bytes||sha(bytes)!==d.sha256)throw new Error(`Archive file checksum mismatch: ${d.name}`);blobs[key]=bytes;
 }
 const header=EpisodeHeaderSchema.parse(decodeJson(blobs.header,'header'));
 if(header.configurationHash!==manifest.configurationHash)throw new Error('Header/manifest configuration mismatch');
 const headerHash=sha(blobs.header),turns=rows('turns',blobs.turns,headerHash,120);
 if(turns.lastHash!==manifest.lastTurnRecordHash)throw new Error('Final turn checksum mismatch');
 const snapshots=rows('private-snapshots',blobs.privateSnapshots,headerHash,manifest.snapshotCount);
 const publicSnapshots=rows('public-snapshots',blobs.publicSnapshots,headerHash,manifest.snapshotCount);
 const terminal=EpisodeTerminalSchema.parse(decodeJson(blobs.terminal,'terminal'));
 const archive=parseArchive({schemaVersion:'episode-archive-1',header,turns:turns.values,terminal,snapshots:snapshots.values},options.expectedConfigurationHash);
 if(canonicalArchive(publicSnapshots.values)!==canonicalArchive(archive.snapshots.map(publicSnapshot)))throw new Error('Public snapshot projection mismatch');
 return archive;
}
