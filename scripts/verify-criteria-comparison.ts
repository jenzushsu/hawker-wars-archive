import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildActionCriteriaRequest,ACTION_CRITERIA_VERSION} from '../packages/providers/src/action-criteria-experiment.ts';
import {runJevVersionComparison} from './jev-version-comparison.ts';
const dir='docs/deployment/evidence/criteria-comparison',read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const r=read(dir+'/result.json'),approval=read('docs/providers/fair-campaign-approval-criteria.json');
const assert=(ok:boolean,message:string)=>{if(!ok)throw new Error(message);};
assert(r.status==='completed'&&r.roundId===approval.roundId&&r.seed===23&&r.model==='jev-1.13.0'&&r.guardEnabled===false,'Run identity');
assert(r.decisions.length===120&&approval.status==='approved','Coverage/approval');
const replay=await runJevVersionComparison({roundId:r.roundId,seed:r.seed,model:r.model,decide:async input=>{
 const d=r.decisions[input.tick];assert(d.tick===input.tick&&JSON.stringify(d.input)===JSON.stringify(input),'Captured observation mismatch');return d.turn;
}});
assert(JSON.stringify(replay)===JSON.stringify(Object.fromEntries(Object.keys(replay).map(k=>[k,r[k]]))),'Replay differs');
assert(r.promptTreatment===ACTION_CRITERIA_VERSION,'Prompt treatment identity');
const sent=r.decisions.filter((d:any)=>d.source==='provider');
assert(sent.length===r.requestEvidence.length,'Request evidence count');
for(const d of sent){const body=JSON.stringify(buildActionCriteriaRequest('jev',d.input,r.model).body),e=r.requestEvidence.find((e:any)=>e.tick===d.tick);assert(e?.bodyHash===createHash('sha256').update(body).digest('hex')&&e.bytes===Buffer.byteLength(body),'Sent request mismatch');}
const calls=r.decisions.reduce((n:number,d:any)=>n+d.turn.attemptCount,0),usage=r.usage.runs.filter((u:any)=>u.run_id===r.roundId);
assert(usage.every((u:any)=>u.provider==='jev')&&usage.reduce((n:number,u:any)=>n+u.attempts,0)===calls&&calls<=120,'Jev-only usage');
assert(r.before.attempts===2299&&r.after.attempts-r.before.attempts===calls,'Ledger continuity');
const delta=(id:string)=>r.after.pools.find((p:any)=>p.id===id).reservedMicros-r.before.pools.find((p:any)=>p.id===id).reservedMicros;
const reservedMicros=delta('jev-separate');assert(reservedMicros===calls*2753&&reservedMicros<=330360&&delta('zoom-shared')===0,'Spending');
assert(r.after.pools.every((p:any)=>p.reservedMicros<=p.capMicros),'Cap');
const waits=r.decisions.filter((d:any)=>d.executedAction==='WAIT'),ticks=(ds:any[])=>ds.map(d=>d.tick);
const prior=read('docs/deployment/evidence/v4-full/analysis.json').find((p:any)=>p.policy==='jev');
const report={status:'verified',roundId:r.roundId,model:r.model,promptTreatment:r.promptTreatment,score:r.score,totals:r.totals,calls,reservedMicros,zoomAllocatedMicros:0,priorRaw113:{score:prior.score,totals:prior.totals},profitDeltaCents:r.score.profitCents-prior.score.profitCents,
 restockTicks:ticks(r.decisions.filter((d:any)=>d.executedAction==='RESTOCK')),cookTicks:ticks(r.decisions.filter((d:any)=>d.executedAction==='COOK')),
 waits:{total:waits.length,forced:ticks(waits.filter((d:any)=>d.source==='forced_wait')),emptyPipelineRestockLegal:ticks(waits.filter((d:any)=>{const o=d.input.observation;return !o.rawPortions&&!o.readyBatches.length&&!o.cooking&&!o.pendingRestock&&d.input.legalActions.includes('RESTOCK');})),serveLegal:ticks(waits.filter((d:any)=>d.input.legalActions.includes('SERVE'))),cookLegal:ticks(waits.filter((d:any)=>d.input.legalActions.includes('COOK')))},
 caveat:'One raw full run per prompt condition, not repeated matched-state trials or causal proof. Prior hybrid results include a safeguard and are separate.'};
writeFileSync(dir+'/analysis.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
