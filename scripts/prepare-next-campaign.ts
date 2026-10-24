import {readFileSync} from 'node:fs';
import {openLedger} from '../packages/providers/src/ledger.ts';
import {readRuntimeConfig,makeLedgerConfig} from './provider-config.ts';
import {LiveStore} from '../packages/live/src/store.ts';
import {createMultiRoundInput} from '../packages/live/src/multi-worker.ts';
import {providerConfigurationHash} from '../packages/live/src/multi-runtime.ts';
// Operator-only, no inference credentials and no automatic budget or round creation.
async function main() {
  const oldHash=process.env.HAWKER_PREVIOUS_LEDGER_HASH!,oldRun=process.env.HAWKER_PREVIOUS_ROUND_ID!;
  const directory=process.env.HAWKER_PROVIDER_LEDGER_DIRECTORY!;
  if(!/^[a-f0-9]{64}$/.test(oldHash)||!oldRun||directory!=='/var/lib/hawker/campaign')throw new Error('Explicit retained ledger and previous identity required');
  const config=readRuntimeConfig(),next=makeLedgerConfig(config),roundId=config.zoomCampaignException!.roundId;
  const approval=config.jevSpendApproval!.approvalReference;
  const authorization=JSON.parse(readFileSync(approval,'utf8'));
  if(authorization.status!=='approved' || authorization.roundId!==roundId || authorization.previousRoundId!==oldRun || authorization.jevCumulativeCapMicros!==config.jevSpendApproval!.campaignCapMicros)throw new Error('Matching approved budget record required');
  const store=new LiveStore({supabaseUrl:process.env.SUPABASE_URL!,serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY!});
  const previous=await store.getRoundStatus(oldRun);
  if(previous?.status!=='completed')throw new Error('Previous round must be completed before operator transition');
  // Existing storage only. This provisioner is intentionally not rerunnable after amendment.
  const old=openLedger(directory,{campaignId:config.campaignId,configurationHash:oldHash});
  const before=old.summary();old.amendBudget(next,approval,oldRun);
  const ledger=openLedger(directory,next);
  try {
    await store.createRound(createMultiRoundInput(roundId,7,providerConfigurationHash(config),false));
    console.log(JSON.stringify({status:'next-campaign-prepared',oldRun,roundId,configurationHash:next.configurationHash,before,after:ledger.summary(),providerDispatch:false}));
  } finally {ledger.close();}
  // Stay readable for operator log verification, then stop this one-use service.
  setInterval(()=>{},30_000);
}
main().catch(()=>{console.error(JSON.stringify({status:'preparation-failed',message:'Inspect retained ledger identity and round state before retrying.'}));process.exitCode=1;});
