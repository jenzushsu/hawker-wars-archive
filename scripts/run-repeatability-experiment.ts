import {relocatePlanningReport} from './experiment-reports.ts';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {DecisionInputSchema} from '../packages/shared/src/index.js';
import {openLedger,LedgerError} from '../packages/providers/src/ledger.ts';
import {createProviderAdapter} from '../packages/providers/src/adapter.ts';
import {buildShortPlanRequest} from '../packages/providers/src/short-plan-experiment.ts';
import {readRuntimeConfig,makeLedgerConfig} from './provider-config.ts';

let stage='startup';
async function main() {
  const directory = '/var/lib/hawker/campaign';
  stage='read-config';
  const config = readRuntimeConfig();
  stage='read-states';
  const states = JSON.parse(readFileSync('docs/deployment/evidence/prompt-v2/jev-investigation.json','utf8')).capturedStates.map((s:unknown)=>DecisionInputSchema.parse(s)).filter((s:{tick:number})=>[57,109].includes(s.tick));
  if (states.length !== 2 || states.map((s:{tick:number})=>s.tick).join(',') !== '57,109') throw new Error('Unexpected experiment states');
  const approval = 'docs/providers/repeatability-approval.json';
  stage='read-approval';
  const approved = JSON.parse(readFileSync(approval,'utf8'));
  if (approved.status !== 'approved' || approved.callsPerModel !== 12) throw new Error('Missing bounded approval');
  let previousRun = '9464d32e-4183-416a-8f29-9d2abae3df86';
  stage='relocate-report';
  console.log(JSON.stringify({status:'report-relocation',moved:relocatePlanningReport('/var/lib/hawker'),ledgerRecordsModified:false}));
  stage='open-ledger';
  let ledger = openLedger(directory,{campaignId:config.campaignId,configurationHash:process.env.HAWKER_PREVIOUS_LEDGER_HASH!});
  stage='check-ledger';
  const before = ledger.summary();
  // Single-use operation. A partial run requires inspection, never automatic reset/retry.
  if (before.attempts !== 638 || before.pools.find(p=>p.id==='jev-separate')?.reservedMicros !== 622178) throw new Error('Unexpected retained ledger');
  config.jevSpendApproval!.campaignCapMicros=655214;
  config.jevSpendApproval!.approvalReference=approval;
  if(approved.jevCumulativeCapMicros!==655214 || approved.runIds.length!==6)throw new Error('Unexpected approval bounds');
  const results = [];
  for (const [index,variant] of (['normal','reversed','reversed','normal','normal','reversed'] as const).entries()) {
    const roundId = approved.runIds[index];
    config.zoomCampaignException = {...config.zoomCampaignException!,roundId,approvalReference:approval};
    const next = makeLedgerConfig(config);
    stage='amend-ledger';
    ledger.amendBudget(next,approval,previousRun);
    stage='reopen-ledger';
    ledger = openLedger(directory,next);
    console.log(JSON.stringify({status:'experiment-transition',variant,roundId,configurationHash:next.configurationHash,summary:ledger.summary()}));
    for (const state of states) {
      const input = DecisionInputSchema.parse({...state,roundId});
      for (const provider of ['jev','zoom','zoom-pro'] as const) {
        const request = buildShortPlanRequest(provider,input,config.providers.jev.model!,variant);
        if (Buffer.byteLength(JSON.stringify(request.body)) > 8192) throw new Error('Experiment request exceeds retained allocation bound');
        const adapter = createProviderAdapter({provider,config,ledger,requestBuilder:(p,i,m)=>buildShortPlanRequest(p,i,m!,variant)});
        stage='dispatch';
        const outcome = await adapter.decideTurn(input);
        const result = {replicate:Math.floor(index/2)+1,variant,provider,tick:input.tick,roundId,outcome};
        results.push(result);
        console.log(JSON.stringify({status:'experiment-result',...result}));
        // Respect shared pool dispatch spacing without retrying any request.
        await new Promise(resolve=>setTimeout(resolve,1100));
      }
    }
    previousRun = roundId;
  }
  const report = {status:'experiment-completed',before,after:ledger.summary(),usage:ledger.usageReport(),results};
  mkdirSync('/var/lib/hawker/reports',{recursive:true,mode:0o700});
  writeFileSync('/var/lib/hawker/reports/repeatability-experiment.json',JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify(report));
  ledger.close();
  setInterval(()=>{},30000);
}
main().catch((error)=>{console.error(JSON.stringify({status:'experiment-failed',stage,code:error instanceof LedgerError ? error.code : ['EACCES','EPERM','ENOENT','EEXIST'].includes(error?.code) ? error.code : 'unclassified',detail:error instanceof LedgerError || ['Unexpected historical report','Report is not a regular file','Refusing to overwrite retained report','Reports directory cannot be a symlink'].includes(error?.message) ? error.message : null,instruction:'Inspect retained ledger and partial logs; do not retry automatically.'}));setInterval(()=>{},30000);});
