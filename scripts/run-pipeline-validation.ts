import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DecisionInputSchema} from '../packages/shared/src/index.ts';
import {buildRequest,canonicalDecisionContext,PROVIDER_PROMPT_VERSION} from '../packages/providers/src/wire.ts';
import {buildPipelineGuidanceRequest,PIPELINE_EXPERIMENT_VERSION} from '../packages/providers/src/pipeline-guidance-experiment.ts';
import {createProviderAdapter} from '../packages/providers/src/adapter.ts';
import {openLedger} from '../packages/providers/src/ledger.ts';
import {readRuntimeConfig,makeLedgerConfig} from './provider-config.ts';
const approvalPath='manifests/pipeline-validation-approval.json',approval=JSON.parse(readFileSync(approvalPath,'utf8'));
const inputs=JSON.parse(readFileSync('manifests/pipeline-validation-inputs.json','utf8')).map((x:unknown)=>DecisionInputSchema.parse(x));
const config=readRuntimeConfig(),providers=['jev','zoom','zoom-pro'] as const;
if(!config.jevSpendApproval||approval.status!=='approved'||approval.callsPerModel!==6||approval.expectedPriorAttempts!==1885||approval.jevAdditionalMaximumMicros!==16518||approval.zoomAdditionalAllocationMicros!==12000||approval.jevCumulativeCapMicros!==config.jevSpendApproval.campaignCapMicros||approval.promptVersion!==PROVIDER_PROMPT_VERSION||approval.experimentVersion!==PIPELINE_EXPERIMENT_VERSION||JSON.stringify(approval.runs.map((r:any)=>[r.tick,r.variant]))!==JSON.stringify([[58,'baseline'],[58,'treatment'],[73,'treatment'],[73,'baseline'],[109,'baseline'],[109,'treatment']])||new Set(approval.runs.map((r:any)=>r.roundId)).size!==6)throw new Error('Unexpected bounded approval');
config.jevSpendApproval.approvalReference=approvalPath;
const sizes:{tick:number;variant:string;provider:string;bytes:number}[]=[];
for(const run of approval.runs){
 const input=DecisionInputSchema.parse({...inputs.find((i:any)=>i.tick===run.tick),roundId:run.roundId});
 const builder=run.variant==='baseline'?buildRequest:buildPipelineGuidanceRequest;
 for(const provider of providers){const bytes=Buffer.byteLength(JSON.stringify(builder(provider,input,config.providers.jev.model!).body));if(bytes>8192)throw new Error('Request bound exceeded');sizes.push({tick:input.tick,variant:run.variant,provider,bytes});}
}
async function main(){
 if(process.argv.includes('--check')){console.log(JSON.stringify({status:'preflight-passed',sizes,providerDispatch:false}));return;}
 const directory='/var/lib/hawker/campaign';
 let ledger=openLedger(directory,{campaignId:config.campaignId,configurationHash:approval.previousLedgerHash});
 const before=ledger.summary();
 if(before.attempts!==1885||before.pools.find(p=>p.id==='jev-separate')?.reservedMicros!==1877546||before.pools.find(p=>p.id==='zoom-shared')?.reservedMicros!==1205000){ledger.close();throw new Error('Retained ledger changed');}
 let previousRun=approval.previousRoundId,configurationHash=approval.previousLedgerHash;const results=[];
 try{
  for(const run of approval.runs){
   config.zoomCampaignException={...config.zoomCampaignException!,roundId:run.roundId,approvalReference:approvalPath};
   const next=makeLedgerConfig(config);ledger.amendBudget(next,approvalPath,previousRun);ledger=openLedger(directory,next);configurationHash=next.configurationHash;
   console.log(JSON.stringify({status:'experiment-transition',...run,configurationHash,summary:ledger.summary()}));
   const input=DecisionInputSchema.parse({...inputs.find((i:any)=>i.tick===run.tick),roundId:run.roundId});
   const contextHash=createHash('sha256').update(canonicalDecisionContext(input)).digest('hex');
   for(const provider of providers){
    const outcome=await createProviderAdapter({provider,config,ledger,requestBuilder:run.variant==='baseline'?buildRequest:buildPipelineGuidanceRequest}).decideTurn(input);
    const result={...run,contextHash,provider,outcome};results.push(result);console.log(JSON.stringify({status:'experiment-result',...result}));
    await new Promise(resolve=>setTimeout(resolve,1100));
   }
   previousRun=run.roundId;
  }
  const report={status:results.every(r=>r.outcome.result.status==='success'&&r.outcome.attemptCount===1)?'experiment-passed':'experiment-completed-with-errors',experimentVersion:PIPELINE_EXPERIMENT_VERSION,configurationHash,lastRunId:previousRun,before,after:ledger.summary(),sizes,results,usage:ledger.usageReport()};
  writeFileSync('/var/lib/hawker/reports/pipeline-validation.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
 }finally{ledger.close();}
 setInterval(()=>{},30000);
}
main().catch(()=>{console.error(JSON.stringify({status:'experiment-failed',instruction:'Inspect retained ledger and partial logs; never retry automatically.'}));setInterval(()=>{},30000);});
