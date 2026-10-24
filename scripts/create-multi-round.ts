import { isAbsolute } from 'node:path';
import { openLedger } from '../packages/providers/src/ledger.ts';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { LiveStore } from '../packages/live/src/store.ts';
import { createMultiRoundInput } from '../packages/live/src/multi-worker.ts';
import { multiControllers, multiProviderBlockers, providerConfigurationHash } from '../packages/live/src/multi-runtime.ts';
import { readRuntimeConfig, makeLedgerConfig } from './provider-config.ts';
async function main() {
  const { values } = parseArgs({ options: { seed: { type: 'string', default: '7' }, publish: { type: 'boolean', default: false } }, strict: true });
  const config = readRuntimeConfig(), blockers = multiProviderBlockers(config);
  const directory = process.env.HAWKER_PROVIDER_LEDGER_DIRECTORY;
  if (!directory || !isAbsolute(directory)) blockers.push('persistent-ledger-absolute-directory-required');
  if (blockers.length) { console.log(JSON.stringify({ status: 'blocked', blockers, providerDispatch: false })); process.exitCode = 2; return; }
  const seed = z.string().regex(/^(0|[1-9]\d?)$/).transform(Number).parse(values.seed);
  const ledger = openLedger(directory!, makeLedgerConfig(config));
  try { multiControllers(config, ledger); } finally { ledger.close(); }
  const roundId = config.zoomCampaignException?.roundId ?? randomUUID();
  const store = new LiveStore({ supabaseUrl: process.env.SUPABASE_URL ?? '', serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '' });
  await store.getMultiWorkerProtocol();
  await store.createRound(createMultiRoundInput(roundId, seed, providerConfigurationHash(config), values.publish));
  console.log(JSON.stringify({ status: 'created', roundId, published: values.publish, voting: false, providerDispatch: false }));
}
main().catch(() => { console.error(JSON.stringify({ status: 'creation-failed', message: 'Inspect authoritative round state before retrying; no provider request was made.' })); process.exitCode = 1; });
