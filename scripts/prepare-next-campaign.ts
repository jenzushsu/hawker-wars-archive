import {readFileSync} from 'node:fs';
import {openLedger,LedgerError} from '../packages/providers/src/ledger.ts';
import {readRuntimeConfig,makeLedgerConfig} from './provider-config.ts';
import {LiveStore} from '../packages/live/src/store.ts';
import {createMultiRoundInput} from '../packages/live/src/multi-worker.ts';
import {providerConfigurationHash} from '../packages/live/src/multi-runtime.ts';
// Operator-only, no inference credentials and no automatic budget or round creation.
let stage='validate-approval';
async function main() {
  const oldHash=process.env.HAWKER_PREVIOUS_LEDGER_HASH!,oldRun=process.env.HAWKER_PREVIOUS_ROUND_ID!;
  const directory=process.env.HAWKER_PROVIDER_LEDGER_DIRECTORY!;
  if(!/^[a-f0-9]{64}$/.test(oldHash)||!oldRun||directory!=='/var/lib/hawker/campaign')throw new Error('Explicit retained ledger and previous identity required');
  const config=readRuntimeConfig(),next=makeLedgerConfig(config),roundId=config.zoomCampaignException!.roundId;
  const approval=config.jevSpendApproval!.approvalReference;
  const authorization=JSON.parse(readFileSync(approval,'utf8'));
  if(authorization.status!=='approved' || authorization.roundId!==roundId || authorization.previousRoundId!==oldRun || authorization.jevCumulativeCapMicros!==config.jevSpendApproval!.campaignCapMicros)throw new Error('Matching approved budget record required');
  stage='check-previous-round';
  const store=new LiveStore({supabaseUrl:process.env.SUPABASE_URL!,serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY!});
  const seed=authorization.seed??7;
  if(!Number.isInteger(seed)||seed<0||seed>99)throw new Error('Invalid approved seed');
  const previous=await store.getRoundStatus(authorization.previousCompletedRoundId??oldRun);
  if(previous?.status!=='completed')throw new Error('Previous round must be completed before operator transition');
  // Existing storage only. This provisioner is intentionally not rerunnable after amendment.
  stage='open-ledger';
  const old=openLedger(directory,{campaignId:config.campaignId,configurationHash:oldHash});
  const before=old.summary();
  if(authorization.expectedPriorAttempts!==undefined && before.attempts!==authorization.expectedPriorAttempts)throw new Error('Unexpected prior ledger records');
  stage='amend-ledger';
  old.amendBudget(next,approval,oldRun);
  const ledger=openLedger(directory,next);
  try {
    stage='create-round';
    await store.createRound(createMultiRoundInput(roundId,seed,providerConfigurationHash(config),false));
    console.log(JSON.stringify({status:'next-campaign-prepared',oldRun,roundId,seed,configurationHash:next.configurationHash,before,after:ledger.summary(),providerDispatch:false}));
  } finally {ledger.close();}
  // Stay readable for operator log verification, then stop this one-use service.
  setInterval(()=>{},30_000);
}
main().catch(error=>{console.error(JSON.stringify({status:'preparation-failed',stage,code:error instanceof LedgerError?error.code:'preparation-error',message:error instanceof LedgerError?error.message:'Inspect retained ledger identity and round state before retrying.'}));setInterval(()=>{},30000);});
