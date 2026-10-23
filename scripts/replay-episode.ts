import { readEpisodeArchive } from '../packages/replay/src/store.js';
import { replayArchive } from '../packages/replay/src/replay.js';
import { configurationHash } from './config-snapshot.js';
const directory=process.argv[2],snapshotText=process.argv[3];
if(!directory||process.argv.length>4||(snapshotText!==undefined&&!/^(0|[1-9]\d{0,2})$/.test(snapshotText)))throw new Error('Usage: pnpm replay:episode <directory> [snapshotSequence]');
const archive=readEpisodeArchive(directory,{expectedConfigurationHash:configurationHash});
const result=replayArchive(archive,snapshotText===undefined?{configurationHash}:{configurationHash,snapshotSequence:Number(snapshotText)});
console.log(JSON.stringify({status:'replayed',mode:result.mode,episodeId:result.episodeId,turns:result.trace.length,resumedAt:result.resumedAt,snapshotsVerified:result.snapshotsVerified,score:result.score,finalHash:result.finalHash,traceHash:result.traceHash,networkCalls:result.networkCalls},null,2));
