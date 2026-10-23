import { writeFileSync, renameSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { LiveProviderSchema } from '../packages/providers/src/activation.js';
import { openLedger } from '../packages/providers/src/ledger.js';
import { createProviderAdapter } from '../packages/providers/src/adapter.js';
import { createInitialFrame, prepareTick } from '../packages/simulation/src/engine.js';
import { decisionInput } from '../packages/simulation/src/observation.js';
import { readRuntimeConfig, makeLedgerConfig, ledgerDirectory, providerStatus, runtimeConfigPath } from './provider-config.js';

const provider=LiveProviderSchema.parse(process.argv[2]);
if(process.argv.length!==3)throw new Error('Usage: pnpm providers:smoke jev|zoom|zoom-pro');
const config=readRuntimeConfig(),status=providerStatus(config,provider);
if(!status.smokeReady){
  console.log(JSON.stringify({status:'blocked',...status,networkCalls:0},null,2));process.exitCode=2;
}else{
  // A fixed shared smoke identity makes repeated invocations recover the same attempt.
  const runId='76af5727-7871-4ea3-89be-16cf4a459dde';
  const ledger=openLedger(ledgerDirectory,{campaignId:config.campaignId,configurationHash:makeLedgerConfig(config).configurationHash});
  try {
    const input=decisionInput(prepareTick(createInitialFrame(),{arrivals:[]}).state,runId);
    const outcome=await createProviderAdapter({provider,config,ledger,mode:'smoke'}).decideTurn(input);
    const success=outcome.result.status==='success'&&outcome.origin!=='forced_wait'&&outcome.result.requestId&&outcome.result.modelVersion;
    if(success){
      // Serialize receipt updates; a crashed lock requires operator recovery, never automatic deletion.
      const lockPath=`${runtimeConfigPath}.lock`,lock=openSync(lockPath,'wx',0o600);
      try {
        const latest=readRuntimeConfig();
        if(JSON.stringify(latest.providers[provider])!==JSON.stringify(config.providers[provider]))throw new Error('Provider configuration changed during smoke; receipt not applied');
        latest.providers[provider].smoke={requestId:outcome.result.requestId!,requestedModel:config.providers[provider].model!,returnedModel:outcome.result.modelVersion!,checkedAt:new Date().toISOString()};
        const temporary=`${runtimeConfigPath}.${randomUUID()}.tmp`;
        try{
          const fd=openSync(temporary,'wx',0o600);
          try{writeFileSync(fd,`${JSON.stringify(latest,null,2)}\n`);fsyncSync(fd);}finally{closeSync(fd);}
          renameSync(temporary,runtimeConfigPath);
        }finally{try{unlinkSync(temporary);}catch{/* rename already removed temporary */}}
      }finally{closeSync(lock);unlinkSync(lockPath);}
    }
    console.log(JSON.stringify({status:success?'smoke-passed':'smoke-not-passed',provider,outcome,ledger:ledger.summary(),networkCalls:outcome.attemptCount},null,2));
    if(!success)process.exitCode=2;
  } finally {ledger.close();}
}
