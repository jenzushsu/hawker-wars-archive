import {readFileSync,writeFileSync} from 'node:fs';
import {DecisionInputSchema} from '../packages/shared/src/index.js';
import {openLedger} from '../packages/providers/src/ledger.ts';
import {createProviderAdapter} from '../packages/providers/src/adapter.ts';
import {buildShortPlanRequest} from '../packages/providers/src/short-plan-experiment.ts';
import {readRuntimeConfig,makeLedgerConfig} from './provider-config.ts';

async function main() {
  const directory = '/var/lib/hawker/campaign';
  const config = readRuntimeConfig();
  const states = JSON.parse(readFileSync('docs/deployment/evidence/prompt-v2/jev-investigation.json','utf8')).capturedStates.map((s:unknown)=>DecisionInputSchema.parse(s)).filter((s:{tick:number})=>[57,109].includes(s.tick));
  if (states.length !== 2 || states.map((s:{tick:number})=>s.tick).join(',') !== '57,109') throw new Error('Unexpected experiment states');
  const approval = 'docs/providers/short-plan-approval.json';
  const approved = JSON.parse(readFileSync(approval,'utf8'));
  if (approved.status !== 'approved' || approved.callsPerModel !== 2) throw new Error('Missing bounded approval');
  let previousRun = '577bb9e5-36df-49e1-895c-880e66d656ee';
  let ledger = openLedger(directory,{campaignId:config.campaignId,configurationHash:process.env.HAWKER_PREVIOUS_LEDGER_HASH!});
  const before = ledger.summary();
  // Single-use operation. A partial run requires inspection, never automatic reset/retry.
  if (before.attempts !== 632 || before.pools.find(p=>p.id==='jev-separate')?.reservedMicros !== 616672) throw new Error('Unexpected retained ledger');
  const results = [];
  for (const [index,variant] of (['short-plan'] as const).entries()) {
    const roundId = approved.runIds[index];
    config.zoomCampaignException = {...config.zoomCampaignException!,roundId,approvalReference:approval};
    const next = makeLedgerConfig(config);
    ledger.amendBudget(next,approval,previousRun);
    ledger = openLedger(directory,next);
    console.log(JSON.stringify({status:'experiment-transition',variant,roundId,configurationHash:next.configurationHash,summary:ledger.summary()}));
    for (const state of states) {
      const input = DecisionInputSchema.parse({...state,roundId});
      for (const provider of ['jev','zoom','zoom-pro'] as const) {
        const request = buildShortPlanRequest(provider,input,config.providers.jev.model!);
        if (Buffer.byteLength(JSON.stringify(request.body)) > 8192) throw new Error('Experiment request exceeds retained allocation bound');
        const adapter = createProviderAdapter({provider,config,ledger,requestBuilder:(p,i,m)=>buildShortPlanRequest(p,i,m!)});
        const outcome = await adapter.decideTurn(input);
        const result = {variant,provider,tick:input.tick,roundId,outcome};
        results.push(result);
        console.log(JSON.stringify({status:'experiment-result',...result}));
        // Respect shared pool dispatch spacing without retrying any request.
        await new Promise(resolve=>setTimeout(resolve,1100));
      }
    }
    previousRun = roundId;
  }
  const report = {status:'experiment-completed',before,after:ledger.summary(),usage:ledger.usageReport(),results};
  writeFileSync(directory+'/short-plan-experiment.json',JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify(report));
  ledger.close();
  setInterval(()=>{},30000);
}
main().catch(()=>{console.error(JSON.stringify({status:'experiment-failed',instruction:'Inspect retained ledger and partial logs; do not retry automatically.'}));process.exitCode=1;});
