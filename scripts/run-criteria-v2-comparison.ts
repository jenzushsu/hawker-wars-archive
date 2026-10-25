import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import {runJevVersionComparison,JEV_VERSION_EXPERIMENT} from './jev-version-comparison.ts';
import {readRuntimeConfig,makeLedgerConfig} from './provider-config.ts';
import {createProviderAdapter} from '../packages/providers/src/adapter.ts';
import {openLedger} from '../packages/providers/src/ledger.ts';
import {PROVIDER_PROMPT_VERSION} from '../packages/providers/src/wire.ts';
import {createHash} from 'node:crypto';
import {buildActionCriteriaV2Request as buildRequest,ACTION_CRITERIA_V2_VERSION as ACTION_CRITERIA_VERSION} from '../packages/providers/src/action-criteria-v2-experiment.ts';
import {createInitialFrame,prepareTick} from '../packages/simulation/src/engine.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
const approvalPath='docs/providers/fair-campaign-approval-criteria-v2.json';
const approval=JSON.parse(readFileSync(approvalPath,'utf8')),config=readRuntimeConfig();
if(approval.promptTreatment!==ACTION_CRITERIA_VERSION||approval.roundId!==config.zoomCampaignException?.roundId||approval.experimentVersion!==JEV_VERSION_EXPERIMENT||approval.promptVersion!==PROVIDER_PROMPT_VERSION||approval.maximumCalls!==120||approval.seed!==23||approval.model!=='jev-1.13.0'||config.providers.jev.model!==approval.model||config.providers.jev.smoke!==null||config.providers.zoom.activationRequested||config.providers['zoom-pro'].activationRequested||approval.jevCumulativeCapMicros!==config.jevSpendApproval?.campaignCapMicros||approval.jevCumulativeCapMicros!==approval.jevPriorReservedMicros+330360||approval.jevAdditionalMaximumMicros!==330360||approval.zoomAdditionalMaximumMicros!==0||config.providers.jev.maximumRequestCost?.micros!==2753)throw new Error('Unexpected Jev-only plan');
async function main(){
 if(process.argv.includes('--check')){
  const input=decisionInput(prepareTick(createInitialFrame(),{arrivals:[]}).state,approval.roundId,[]);
  const request=buildRequest('jev',input,approval.model),bytes=Buffer.byteLength(JSON.stringify(request.body));
  if(request.requestedModel!==approval.model||bytes>65536)throw new Error('Request mismatch');
  console.log(JSON.stringify({status:'criteria-v2-preflight-passed',approvalStatus:approval.status,roundId:approval.roundId,model:approval.model,guardEnabled:false,maximumCalls:120,jevCapMicros:approval.jevCumulativeCapMicros,requestBytes:bytes,providerDispatch:false}));return;
 }
 if(approval.status!=='approved'){console.log(JSON.stringify({status:'blocked',reason:'criteria-v2-budget-approval-required',providerDispatch:false}));process.exitCode=2;return;}
 const reportPath=`/var/lib/hawker/reports/criteria-v2-${approval.roundId}.json`;
 const lock=openSync(reportPath+'.lock','wx',0o600);closeSync(lock);
 const directory='/var/lib/hawker/campaign';let ledger=openLedger(directory,{campaignId:config.campaignId,configurationHash:approval.previousLedgerHash});
 const before=ledger.summary();
 if(before.attempts!==approval.expectedPriorAttempts||before.pools.find(p=>p.id==='jev-separate')?.reservedMicros!==approval.jevPriorReservedMicros||before.pools.find(p=>p.id==='zoom-shared')?.reservedMicros!==approval.zoomPriorAllocatedMicros){ledger.close();throw new Error('Retained ledger changed');}
 const next=makeLedgerConfig(config);ledger.amendBudget(next,approvalPath,approval.previousRoundId);ledger=openLedger(directory,next);
 console.log(JSON.stringify({status:'criteria-v2-ledger-transition',roundId:approval.roundId,configurationHash:next.configurationHash,before}));
 const checkpoint=async(record:unknown)=>{const temp=reportPath+'.tmp',fd=openSync(temp,'w',0o600);try{writeFileSync(fd,JSON.stringify(record));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,reportPath);};
 let smokeVerified=false;const requestEvidence:{tick:number;bodyHash:string;bytes:number}[]=[];
 try{
  const report=await runJevVersionComparison({roundId:approval.roundId,seed:approval.seed,model:approval.model,decide:async(input)=>{
   if(input.legalActions.length>1){const body=JSON.stringify(buildRequest('jev',input,approval.model).body);requestEvidence.push({tick:input.tick,bodyHash:createHash('sha256').update(body).digest('hex'),bytes:Buffer.byteLength(body)});}
   const turn=await createProviderAdapter({provider:'jev',config,ledger,requestBuilder:buildRequest,mode:smokeVerified?'live':'smoke'}).decideTurn(input);
   if(turn.result.status!=='success'){console.log(JSON.stringify({status:'criteria-v2-provider-failure',tick:input.tick,turn}));throw new Error('Stop on provider failure');}
   if(!smokeVerified){
    if(input.tick!==0||turn.origin!=='provider'||turn.attemptCount!==1||turn.result.modelVersion!==approval.model||!turn.result.requestId)throw new Error('Model identity smoke failed');
    config.providers.jev.smoke={requestId:turn.result.requestId,requestedModel:approval.model,returnedModel:turn.result.modelVersion!,checkedAt:new Date().toISOString()};smokeVerified=true;
    console.log(JSON.stringify({status:'criteria-v2-smoke-passed',tick:0,smoke:config.providers.jev.smoke}));
   }
   await new Promise(resolve=>setTimeout(resolve,1100));return turn;
  },checkpoint:async(record)=>{await checkpoint(record);const tick=(record as {tick:number}).tick;if(tick%10===0)console.log(JSON.stringify({status:'criteria-v2-progress',roundId:approval.roundId,tick}));}});
  const receipt={...report,promptTreatment:ACTION_CRITERIA_VERSION,requestEvidence,configurationHash:next.configurationHash,smoke:config.providers.jev.smoke,before,after:ledger.summary(),usage:ledger.usageReport()};await checkpoint(receipt);console.log(JSON.stringify(receipt));
 }finally{ledger.close();}
 setInterval(()=>{},30000);
}
main().catch(()=>{console.error(JSON.stringify({status:'criteria-v2-failed',instruction:'Inspect retained ledger/checkpoint and partial logs. Never reset or retry automatically.'}));setInterval(()=>{},30000);});
