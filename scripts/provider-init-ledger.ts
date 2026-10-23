import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeLedger } from '../packages/providers/src/ledger.js';
import { activationBlockers } from '../packages/providers/src/activation.js';
import { readRuntimeConfig, makeLedgerConfig, ledgerDirectory } from './provider-config.js';
const config=readRuntimeConfig();
if(['jev','zoom','zoom-pro'].every(p=>activationBlockers(config,p as 'jev'|'zoom'|'zoom-pro','smoke').length>0)) {
  console.log(JSON.stringify({status:'blocked',reason:'No provider has verified bounded billing; ledger was not created.',networkCalls:0}));
  process.exitCode=2;
} else {
  mkdirSync(dirname(ledgerDirectory),{recursive:true,mode:0o700});
  const ledger=initializeLedger(ledgerDirectory,makeLedgerConfig(config));
  try {console.log(JSON.stringify({status:'initialized',ledgerDirectory,...ledger.summary(),networkCalls:0}));}
  finally {ledger.close();}
}
