import {readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DecisionInputSchema} from '../packages/shared/src/index.ts';
import {canonicalDecisionContext,PROVIDER_PROMPT_VERSION} from '../packages/providers/src/wire.ts';
import {buildActionCriteriaRequest as buildRequest} from '../packages/providers/src/action-criteria-experiment.ts';
import {buildActionCriteriaV2Request as buildPipelineGuidanceRequest,ACTION_CRITERIA_V2_VERSION as PIPELINE_EXPERIMENT_VERSION} from '../packages/providers/src/action-criteria-v2-experiment.ts';
import {createProviderAdapter} from '../packages/providers/src/adapter.ts';
import {openLedger} from '../packages/providers/src/ledger.ts';
import {readRuntimeConfig,makeLedgerConfig} from './provider-config.ts';
const approvalPath='manifests/cooking-test-approval.json',approval=JSON.parse(readFileSync(approvalPath,'utf8'));
const inputs=JSON.parse(readFileSync('manifests/cooking-test-inputs.json','utf8')).map((x:unknown)=>DecisionInputSchema.parse(x));
const config=readRuntimeConfig(),providers=['jev'] as const;
if(!config.jevSpendApproval||approval.status!=='approved'||approval.callsPerModel!==12||approval.expectedPriorAttempts!==2404||approval.jevAdditionalMaximumMicros!==33036||approval.zoomAdditionalAllocationMicros!==0||approval.jevCumulativeCapMicros!==config.jevSpendApproval.campaignCapMicros||approval.promptVersion!==PROVIDER_PROMPT_VERSION||approval.experimentVersion!==PIPELINE_EXPERIMENT_VERSION||config.providers.jev.model!=='jev-1.13.0'||config.providers.zoom.activationRequested||config.providers['zoom-pro'].activationRequested||approval.runs.length!==12||new Set(approval.runs.map((r:any)=>r.roundId)).size!==12||[86,87].some(t=>['baseline','treatment'].some(v=>approval.runs.filter((r:any)=>r.tick===t&&r.variant===v).length!==3)))throw new Error('Unexpected bounded approval');
config.jevSpendApproval.approvalReference=approvalPath;
const sizes:{tick:number;variant:string;provider:string;bytes:number}[]=[];
for(const run of approval.runs){
 const input=DecisionInputSchema.parse({...inputs.find((i:any)=>i.tick===run.tick),roundId:run.roundId});
 const builder=run.variant==='baseline'?buildRequest:buildPipelineGuidanceRequest;
 for(const provider of providers){const bytes=Buffer.byteLength(JSON.stringify(builder(provider,input,config.providers.jev.model!).body));if(bytes>8192)throw new Error('Request bound exceeded');sizes.push({tick:input.tick,variant:run.variant,provider,bytes});}
}
async function main(){
 if(process.argv.includes('--check')){console.log(JSON.stringify({status:'preflight-passed',sizes,providerDispatch:false}));return;}
 const lock=openSync('/var/lib/hawker/reports/cooking-test.lock','wx',0o600);closeSync(lock);
 const directory='/var/lib/hawker/campaign';
 let ledger=openLedger(directory,{campaignId:config.campaignId,configurationHash:approval.previousLedgerHash});
 const before=ledger.summary();
 if(before.attempts!==2404||before.pools.find(p=>p.id==='jev-separate')?.reservedMicros!==2747494||before.pools.find(p=>p.id==='zoom-shared')?.reservedMicros!==1408000){ledger.close();throw new Error('Retained ledger changed');}
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
    const builder=run.variant==='baseline'?buildRequest:buildPipelineGuidanceRequest;const body=JSON.stringify(builder(provider,input,config.providers.jev.model!).body);
    const result={...run,contextHash,bodyHash:createHash('sha256').update(body).digest('hex'),provider,outcome};results.push(result);console.log(JSON.stringify({status:'experiment-result',...result}));
    if(outcome.result.status!=='success'||outcome.attemptCount!==1||outcome.result.modelVersion!=='jev-1.13.0')throw new Error('Stop on failed call');
    await new Promise(resolve=>setTimeout(resolve,1100));
   }
   previousRun=run.roundId;
  }
  const report={status:results.every(r=>r.outcome.result.status==='success'&&r.outcome.attemptCount===1)?'completed':'experiment-completed-with-errors',experimentVersion:PIPELINE_EXPERIMENT_VERSION,configurationHash,lastRunId:previousRun,before,after:ledger.summary(),sizes,results,usage:ledger.usageReport()};
  writeFileSync('/var/lib/hawker/reports/cooking-test.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
 }finally{ledger.close();}
 setInterval(()=>{},30000);
}
main().catch(()=>{console.error(JSON.stringify({status:'experiment-failed',instruction:'Inspect retained ledger and partial logs; never retry automatically.'}));setInterval(()=>{},30000);});
