import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalDecisionContext} from '../packages/providers/src/wire.ts';
import {buildActionCriteriaRequest} from '../packages/providers/src/action-criteria-experiment.ts';
import {buildActionCriteriaV2Request} from '../packages/providers/src/action-criteria-v2-experiment.ts';
import {DecisionInputSchema} from '../packages/shared/src/index.ts';
const dir='docs/deployment/evidence/cooking-test',read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const r=read(dir+'/result.json'),a=read('manifests/cooking-test-approval.json'),inputs=read('manifests/cooking-test-inputs.json');
const assert=(ok:boolean,m:string)=>{if(!ok)throw new Error(m);};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
assert(r.status==='completed'&&r.results.length===12,'Completion');
for(let i=0;i<12;i++){
 const e=r.results[i],plan=a.runs[i];for(const k of ['roundId','tick','variant','repetition'])assert(e[k]===plan[k],'Schedule');
 const input=DecisionInputSchema.parse({...inputs.find((s:any)=>s.tick===e.tick),roundId:e.roundId}),builder=e.variant==='baseline'?buildActionCriteriaRequest:buildActionCriteriaV2Request;
 assert(e.contextHash===hash(canonicalDecisionContext(input))&&e.bodyHash===hash(JSON.stringify(builder('jev',input,'jev-1.13.0').body)),'Request hash');
 assert(e.outcome.result.status==='success'&&e.outcome.result.modelVersion==='jev-1.13.0'&&e.outcome.attemptCount===1&&e.outcome.origin==='provider','Provider identity/status');
}
const usage=r.usage.runs.filter((u:any)=>a.runs.some((x:any)=>x.roundId===u.run_id));
assert(usage.every((u:any)=>u.provider==='jev')&&usage.reduce((n:number,u:any)=>n+u.attempts,0)===12,'Usage');
assert(r.before.attempts===2404&&r.after.attempts===2416,'Ledger continuity');
const delta=(id:string)=>r.after.pools.find((p:any)=>p.id===id).reservedMicros-r.before.pools.find((p:any)=>p.id===id).reservedMicros;
assert(delta('jev-separate')===33036&&delta('zoom-shared')===0,'Exposure');
assert(r.after.pools.every((p:any)=>p.reservedMicros<=p.capMicros),'Caps');
const groups=[86,87].flatMap(tick=>['baseline','treatment'].map(variant=>{const rows=r.results.filter((e:any)=>e.tick===tick&&e.variant===variant);assert(rows.length===3&&new Set(rows.map((e:any)=>e.contextHash)).size===1,'Group matching');return {tick,variant,choices:rows.map((e:any)=>e.outcome.result.action),cookProbabilities:rows.map((e:any)=>e.outcome.result.probabilities.find((p:any)=>p.action==='COOK').probability)};}));
const report={status:'verified',groups,calls:12,addedReservedMicros:33036,ledger:r.after,caveat:'Three repetitions per condition, alternating predetermined order; not randomized or statistically conclusive. Same-state choices do not establish full-round gains.'};
writeFileSync(dir+'/analysis.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
