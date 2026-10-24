import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { LiveStore } from '../packages/live/src/store.ts';
import { runMultiTick } from '../packages/live/src/multi-worker.ts';
import { multiControllers, multiProviderBlockers, providerConfigurationHash } from '../packages/live/src/multi-runtime.ts';
import { superviseRulesWorker } from '../packages/live/src/supervisor.ts';
import { openLedger } from '../packages/providers/src/ledger.ts';
import { readRuntimeConfig, makeLedgerConfig } from './provider-config.ts';

async function main() {
  const config = readRuntimeConfig(), blockers = multiProviderBlockers(config);
  const directory = process.env.HAWKER_PROVIDER_LEDGER_DIRECTORY;
  if (!directory || !isAbsolute(directory)) blockers.push('persistent-ledger-absolute-directory-required');
  if (blockers.length) {
    console.log(JSON.stringify({ status: 'blocked', blockers, providerDispatch: false }));
    process.exitCode = 2; return;
  }
  const roundId = z.string().uuid().parse(process.env.HAWKER_ROUND_ID).toLowerCase();
  if(config.zoomCampaignException && roundId!==config.zoomCampaignException.roundId)throw new Error('Round outside approval');
  // Never initialize storage at startup. A missing or changed volume cannot
  // silently replenish the approved campaign or permit replaying requests.
  const expected = makeLedgerConfig(config);
  const ledger = openLedger(directory!, expected);
  const controller = new AbortController(), stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    const controllers = multiControllers(config, ledger);
    const store = new LiveStore({ supabaseUrl: process.env.SUPABASE_URL ?? '', serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '' });
    await store.getMultiWorkerProtocol();
    const ownerId = randomUUID(), identity = providerConfigurationHash(config);
    console.log(JSON.stringify({ status: 'supervising', roundId, policyIds: ['rules', 'jev', 'zoom', 'zoom-pro'], voting: false }));
    await superviseRulesWorker({ tick: () => runMultiTick(store, { roundId, ownerId, providerConfigurationHash: identity }, controllers),
      signal: controller.signal, report: event => {console.log(JSON.stringify({roundId,...event}));if(event.status==='completed'||event.status==='stopped'||event.status==='halted')console.log(JSON.stringify({status:'campaign-accounting',roundId,summary:ledger.summary(),usage:ledger.usageReport()}));} });
  } finally { console.log(JSON.stringify({status:'ledger-summary',summary:ledger.summary()})); ledger.close(); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
}
main().catch(() => { console.error(JSON.stringify({ status: 'configuration-error', message: 'Check the selected round, staging credentials, approved runtime manifest and existing persistent ledger.' })); process.exitCode = 1; });
