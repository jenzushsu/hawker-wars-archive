import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runHybridComparison,HYBRID_VERSION} from './hybrid-comparison.ts';
import {readRuntimeConfig,makeLedgerConfig} from './provider-config.ts';
import {createProviderAdapter} from '../packages/providers/src/adapter.ts';
import {openLedger} from '../packages/providers/src/ledger.ts';
import {canonicalDecisionContext,PROVIDER_PROMPT_VERSION} from '../packages/providers/src/wire.ts';
import type {DecisionInput} from '../packages/shared/src/index.ts';
const approvalPath='docs/providers/fair-campaign-approval-hybrid.json';
const approval=JSON.parse(readFileSync(approvalPath,'utf8')),config=readRuntimeConfig();
if(approval.roundId!==config.zoomCampaignException?.roundId||approval.hybridVersion!==HYBRID_VERSION||approval.promptVersion!==PROVIDER_PROMPT_VERSION||approval.maximumCallsPerModel!==120||approval.seed!==23||approval.jevCumulativeCapMicros!==config.jevSpendApproval?.campaignCapMicros||approval.jevCumulativeCapMicros!==approval.jevPriorReservedMicros+330360||approval.jevAdditionalMaximumMicros!==330360||approval.zoomAdditionalMaximumMicros!==240000)throw new Error('Unexpected hybrid plan');
async function main(){
 if(process.argv.includes('--check')){console.log(JSON.stringify({status:'hybrid-preflight-passed',approvalStatus:approval.status,roundId:approval.roundId,jevCapMicros:approval.jevCumulativeCapMicros,providerDispatch:false}));return;}
 // Budget approval is mandatory before opening/amending the ledger or dispatching.
 if(approval.status!=='approved'){console.log(JSON.stringify({status:'blocked',reason:'hybrid-budget-approval-required',providerDispatch:false}));process.exitCode=2;return;}
 const reportPath=`/var/lib/hawker/reports/hybrid-${approval.roundId}.json`;
 const lock=openSync(reportPath+'.lock','wx',0o600);closeSync(lock); // No automatic reuse after partial execution.
 const directory='/var/lib/hawker/campaign';let ledger=openLedger(directory,{campaignId:config.campaignId,configurationHash:approval.previousLedgerHash});
 const before=ledger.summary();
 if(before.attempts!==approval.expectedPriorAttempts||before.pools.find(p=>p.id==='jev-separate')?.reservedMicros!==approval.jevPriorReservedMicros||before.pools.find(p=>p.id==='zoom-shared')?.reservedMicros!==approval.zoomPriorAllocatedMicros){ledger.close();throw new Error('Retained ledger changed');}
 const next=makeLedgerConfig(config);ledger.amendBudget(next,approvalPath,approval.previousRoundId);ledger=openLedger(directory,next);
 console.log(JSON.stringify({status:'hybrid-ledger-transition',roundId:approval.roundId,configurationHash:next.configurationHash,before}));
 const checkpoint=async(record:unknown)=>{const temp=reportPath+'.tmp',fd=openSync(temp,'w',0o600);try{writeFileSync(fd,JSON.stringify(record));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,reportPath);};
 const controller=(provider:'jev'|'zoom'|'zoom-pro')=>{const adapter=createProviderAdapter({provider,config,ledger});return async(input:DecisionInput)=>{
  const turn=await adapter.decideTurn(input);
  if(turn.result.status==='fallback')console.log(JSON.stringify({status:'hybrid-provider-fallback',tick:input.tick,provider,reason:turn.result.fallbackReason,diagnostic:turn.diagnostic}));
  if(['budget','quota','rate-limit'].includes(turn.result.fallbackReason??''))throw new Error('Accounting gate; inspect before resuming');
  await new Promise(resolve=>setTimeout(resolve,1100));return turn;
 };};
 try{
  const report=await runHybridComparison({roundId:approval.roundId,seed:approval.seed,controllers:{jev:controller('jev'),zoom:controller('zoom'),'zoom-pro':controller('zoom-pro')},checkpoint:async(record)=>{await checkpoint(record);const tick=(record as {tick:number}).tick;if(tick%10===0)console.log(JSON.stringify({status:'hybrid-progress',roundId:approval.roundId,tick}));}});
  const receipt={...report,configurationHash:next.configurationHash,before,after:ledger.summary(),usage:ledger.usageReport()};await checkpoint(receipt);
  // Compact receipt retains both action choices and an independently replayable input hash.
  console.log(JSON.stringify({...receipt,decisions:report.decisions.map(({input,...decision})=>({...decision,inputHash:createHash('sha256').update(JSON.stringify(input)).digest('hex'),contextHash:input.legalActions.length>1?createHash('sha256').update(canonicalDecisionContext(input)).digest('hex'):null}))}));
 }finally{ledger.close();}
 setInterval(()=>{},30000);
}
main().catch(()=>{console.error(JSON.stringify({status:'hybrid-failed',instruction:'Inspect retained ledger/checkpoint and partial logs. Never reset or retry automatically.'}));setInterval(()=>{},30000);});
