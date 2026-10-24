import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LiveStore } from '../packages/live/src/store.ts';
import { runRulesTick } from '../packages/live/src/worker.ts';
import { superviseRulesWorker } from '../packages/live/src/supervisor.ts';

async function main() {
  const roundId = z.string().uuid().parse(process.env.HAWKER_ROUND_ID).toLowerCase();
  const store = new LiveStore({ supabaseUrl: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '' });
  const ownerId = randomUUID(), controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  console.log(JSON.stringify({ status: 'supervising', roundId, providerDispatch: false }));
  try {
    await superviseRulesWorker({
      tick: () => runRulesTick(store, { roundId, ownerId }), signal: controller.signal,
      report: event => console.log(JSON.stringify({ roundId, ...event })),
    });
  } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
  console.log(JSON.stringify({ status: 'shutdown', roundId }));
}
main().catch(() => {
  console.error(JSON.stringify({ status: 'configuration-error',
    message: 'Check HAWKER_ROUND_ID, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' }));
  process.exitCode = 1;
});
