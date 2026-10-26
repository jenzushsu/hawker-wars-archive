import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {DecisionInputSchema} from '../packages/shared/src/index.ts';
import {buildRequest,canonicalDecisionContext,PROVIDER_PROMPT_VERSION} from '../packages/providers/src/wire.ts';
import {createProviderAdapter} from '../packages/providers/src/adapter.ts';
import {openLedger} from '../packages/providers/src/ledger.ts';
import {readRuntimeConfig,makeLedgerConfig} from './provider-config.ts';
const approvalPath='manifests/tick63-approval.json';
const approval=JSON.parse(readFileSync(approvalPath,'utf8'));
const config=readRuntimeConfig();
const input=DecisionInputSchema.parse({...JSON.parse(readFileSync('manifests/tick63-input.json','utf8')),roundId:approval.roundId});
if(!config.jevSpendApproval||approval.status!=='approved'||approval.callsPerModel!==1||approval.expectedPriorAttempts!==1876||approval.promptVersion!==PROVIDER_PROMPT_VERSION||approval.jevAdditionalMaximumMicros!==2753||approval.zoomAdditionalAllocationMicros!==2000||config.jevSpendApproval?.campaignCapMicros!==approval.jevCumulativeCapMicros)throw new Error('Unexpected smoke approval');
config.jevSpendApproval.approvalReference=approvalPath;
config.zoomCampaignException={...config.zoomCampaignException!,roundId:input.roundId,approvalReference:approvalPath};
const providers=['jev','zoom','zoom-pro'] as const;
if(input.tick!==63||JSON.stringify(input.legalActions)!==JSON.stringify(['RESTOCK','WAIT'])||input.observation.cashCents!==38000||input.observation.queue.length!==4||input.observation.rawPortions!==0||input.observation.readyBatches.length||input.observation.cooking||input.observation.pendingRestock)throw new Error('Unexpected diagnostic state');
const context=canonicalDecisionContext(input);
if(context!==canonicalDecisionContext(DecisionInputSchema.parse(JSON.parse(readFileSync('manifests/tick63-input.json','utf8')))))throw new Error('Diagnostic context changed');
const contextHash=createHash('sha256').update(context).digest('hex');
const sizes=providers.map(provider=>({provider,bytes:Buffer.byteLength(JSON.stringify(buildRequest(provider,input,config.providers.jev.model!).body))}));
if(sizes.some(s=>s.bytes>8192))throw new Error('Smoke size bound failed');
async function main(){
 if(process.argv.includes('--check')){console.log(JSON.stringify({status:'smoke-preflight-passed',sizes,providerDispatch:false}));return;}
 const directory='/var/lib/hawker/campaign';
 let ledger=openLedger(directory,{campaignId:config.campaignId,configurationHash:approval.previousLedgerHash});
 const before=ledger.summary();
 if(before.attempts!==approval.expectedPriorAttempts||before.pools.find(p=>p.id==='jev-separate')?.reservedMicros!==approval.jevPriorReservedMicros||before.pools.find(p=>p.id==='zoom-shared')?.reservedMicros!==1199000){ledger.close();throw new Error('Retained ledger changed; inspect before retry');}
 const next=makeLedgerConfig(config);
 ledger.amendBudget(next,approvalPath,approval.previousRoundId);
 ledger=openLedger(directory,next);
 console.log(JSON.stringify({status:'smoke-ledger-transition',configurationHash:next.configurationHash,roundId:input.roundId,before}));
 const results=[];
 try{
  for(const provider of providers){
   const outcome=await createProviderAdapter({provider,config,ledger}).decideTurn(input);
   results.push({provider,outcome});
   console.log(JSON.stringify({status:'smoke-provider-result',provider,outcome}));
   await new Promise(resolve=>setTimeout(resolve,1100));
  }
  const after=ledger.summary();
  const report={status:results.every(r=>r.outcome.result.status==='success'&&r.outcome.attemptCount===1)?'smoke-passed':'smoke-completed-with-errors',promptVersion:PROVIDER_PROMPT_VERSION,contextHash,sourceTick:input.tick,roundId:input.roundId,configurationHash:next.configurationHash,sizes,before,after,results,usage:ledger.usageReport()};
  writeFileSync('/var/lib/hawker/reports/tick63-comparison.json',JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify(report));
 }finally{ledger.close();}
 // Keep logs available; operator restores standby after reading the receipt.
 setInterval(()=>{},30000);
}
main().catch(()=>{console.error(JSON.stringify({status:'smoke-failed',instruction:'Inspect retained ledger and partial logs; never retry automatically.'}));setInterval(()=>{},30000);});
