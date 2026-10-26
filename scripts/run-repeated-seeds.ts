import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {readRuntimeConfig,makeLedgerConfig} from './provider-config.ts';
import {openLedger} from '../packages/providers/src/ledger.ts';
import {LiveStore} from '../packages/live/src/store.ts';
import {createMultiRoundInput,runMultiTick} from '../packages/live/src/multi-worker.ts';
import {multiControllers,multiProviderBlockers,providerConfigurationHash} from '../packages/live/src/multi-runtime.ts';

const planSchema=z.object({status:z.literal('approved'),scenario:z.literal('clean'),runs:z.array(z.object({roundId:z.string().uuid(),seed:z.number().int().min(0).max(99),repetition:z.number().int().min(1).max(2)}).strict()).length(6),promptTreatment:z.literal('action-criteria-prompt-1'),previousRoundId:z.string().uuid(),previousLedgerHash:z.string().regex(/^[a-f0-9]{64}$/),expectedPriorAttempts:z.number().int(),jevPriorReservedMicros:z.number().int(),jevCumulativeCapMicros:z.number().int(),zoomPriorAllocatedMicros:z.number().int(),published:z.literal(false)}).passthrough();
const approval='docs/providers/repeated-seed-plan.json';
const plan=planSchema.parse(JSON.parse(readFileSync(approval,'utf8')));
if(JSON.stringify(plan.runs.map(r=>[r.seed,r.repetition]))!==JSON.stringify([[31,1],[31,2],[47,1],[47,2],[59,1],[59,2]]))throw new Error('Unapproved run schedule');
const directory=process.env.HAWKER_PROVIDER_LEDGER_DIRECTORY;
if(directory!=='/var/lib/hawker/campaign')throw new Error('Retained campaign volume required');
const config=readRuntimeConfig();
if(config.jevSpendApproval?.approvalReference!==approval||config.jevSpendApproval.campaignCapMicros!==plan.jevCumulativeCapMicros)throw new Error('Approved provider configuration unavailable');
if(plan.jevPriorReservedMicros+plan.runs.length*120*2753!==plan.jevCumulativeCapMicros || plan.zoomPriorAllocatedMicros+plan.runs.length*240*1000>5000000)throw new Error('Budget arithmetic mismatch');
if(process.argv.includes('--check')){console.log(JSON.stringify({status:'repeatability-preflight',runs:plan.runs.length,seeds:plan.runs.map(r=>r.seed),jevCapMicros:plan.jevCumulativeCapMicros,providerDispatch:false}));process.exit(0);}
if(multiProviderBlockers(config).length)throw new Error('Provider credentials or activation unavailable');
const store=new LiveStore({supabaseUrl:process.env.SUPABASE_URL!,serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY!});
await store.getMultiWorkerProtocol();
let previousHash=plan.previousLedgerHash,previousId=plan.previousRoundId;
for(let index=0;index<plan.runs.length;index++){
 const run=plan.runs[index]!;
 const prior=await store.getRoundStatus(previousId);
 if(prior?.status!=='completed')throw new Error(`Previous round incomplete before ${index+1}`);
 config.zoomCampaignException={...config.zoomCampaignException!,roundId:run.roundId};
 const next=makeLedgerConfig(config);
 const priorLedger=openLedger(directory,{campaignId:config.campaignId,configurationHash:previousHash});
 const before=priorLedger.summary();
 try{
  if(index===0&&(before.attempts!==plan.expectedPriorAttempts||before.pools.find(p=>p.id==='jev-separate')?.reservedMicros!==plan.jevPriorReservedMicros||before.pools.find(p=>p.id==='zoom-shared')?.reservedMicros!==plan.zoomPriorAllocatedMicros))throw new Error('Retained ledger identity mismatch');
  priorLedger.amendBudget(next,approval,previousId);
 }finally{priorLedger.close();}
 const ledger=openLedger(directory,next);
 try{
  await store.createRound(createMultiRoundInput(run.roundId,run.seed,providerConfigurationHash(config,plan.promptTreatment),false));
  console.log(JSON.stringify({status:'round-created',index:index+1,...run,accounting:ledger.summary()}));
  const controllers=multiControllers(config,ledger,plan.promptTreatment),ownerId=randomUUID(),identity=providerConfigurationHash(config,plan.promptTreatment);
  for(let tick=0;tick<=120;tick++){
   const result=await runMultiTick(store,{roundId:run.roundId,ownerId,providerConfigurationHash:identity},controllers);
   if(result.status!==(tick===120?'completed':'committed')||result.tick!==tick||result.sequence!==tick+1)throw new Error(`Round ${index+1} stalled at tick ${tick}`);
   if(tick%10===0||tick===120)console.log(JSON.stringify({status:'round-progress',index:index+1,roundId:run.roundId,tick,accounting:tick===120?ledger.summary():undefined}));
   if(tick<120)await delay(5100);
  }
 }finally{ledger.close();}
 previousHash=next.configurationHash;previousId=run.roundId;
}
console.log(JSON.stringify({status:'batch-completed',rounds:plan.runs.length}));
