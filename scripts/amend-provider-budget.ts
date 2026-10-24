import { openLedger } from '../packages/providers/src/ledger.ts';
import { readRuntimeConfig, makeLedgerConfig, ledgerDirectory } from './provider-config.ts';

// Explicit operator command only; never called by worker startup or smoke.
const [previousHash, approvalReference] = process.argv.slice(2);
if (process.argv.length !== 4 || !/^[a-f0-9]{64}$/.test(previousHash ?? '') || !approvalReference) {
  throw new Error('Usage: tsx scripts/amend-provider-budget.ts PREVIOUS_CONFIG_HASH APPROVAL_REFERENCE');
}
const config = readRuntimeConfig(), next = makeLedgerConfig(config);
if (config.jevSpendApproval?.approvalReference !== approvalReference) throw new Error('Approval must match the runtime configuration');
const old = openLedger(ledgerDirectory, { campaignId: config.campaignId, configurationHash: previousHash! });
try {
  const before = old.summary();
  old.amendBudget(next, approvalReference);
  const updated = openLedger(ledgerDirectory, next);
  try { console.log(JSON.stringify({status:'amended',approvalReference,previousConfigurationHash:previousHash,configurationHash:next.configurationHash,before,after:updated.summary(),providerDispatch:false},null,2)); }
  finally { updated.close(); }
} finally { old.close(); }
