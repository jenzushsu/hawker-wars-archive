import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { LiveStore, LiveStoreError } from '../packages/live/src/store.ts';
import { createRulesRoundInput, runRulesTick } from '../packages/live/src/worker.ts';

async function main() {
  const { values } = parseArgs({ options: {
    round: { type: 'string' }, owner: { type: 'string' }, create: { type: 'boolean', default: false },
    publish: { type: 'boolean', default: false }, voting: { type: 'boolean', default: false }, seed: { type: 'string' }, steps: { type: 'string', default: '1' },
    help: { type: 'boolean', default: false },
  }, strict: true, allowPositionals: false });
  if (values.help) {
    console.log('Usage: pnpm worker:rules --round UUID [--owner UUID] [--create --seed 0..99 --publish --voting] [--steps 1..121]');
    console.log('Rules-only exhibition worker. Defaults: one bounded step, private round, seed 7. Between steps: at least 5 seconds.');
    return;
  }
  const roundId = z.string().uuid().parse(values.round).toLowerCase();
  const ownerId = z.string().uuid().parse(values.owner ?? randomUUID()).toLowerCase();
  if (!/^\d+$/.test(values.steps!)) throw new Error('invalid steps');
  const steps = z.number().int().min(1).max(121).parse(Number(values.steps));
  if ((!values.create && (values.seed !== undefined || values.publish || values.voting)) || (values.seed !== undefined && !/^\d+$/.test(values.seed))) throw new Error('invalid create options');
  const seed = z.number().int().min(0).max(99).parse(Number(values.seed ?? '7'));
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error('missing store configuration');
  const store = new LiveStore({ supabaseUrl, serviceRoleKey });
  if (values.create) {
    await store.createRound(createRulesRoundInput(roundId, seed, values.publish, values.voting));
    console.log(JSON.stringify({ status: 'created', roundId, policy: 'rules', votingEnabled: values.voting, providerDispatch: false }));
  }
  // No detached work or retry loop. An error ends this process; a later invocation
  // reads authoritative recovery before deciding whether another tick is due.
  for (let step = 0; step < steps; step++) {
    if (step > 0) await delay(5000);
    const result = await runRulesTick(store, { roundId, ownerId });
    console.log(JSON.stringify({ roundId, ...result }));
    if (['completed', 'paused', 'stopped'].includes(result.status)) break;
  }
}
main().catch(error => {
  const code = error instanceof LiveStoreError ? error.code : 'worker';
  console.error(JSON.stringify({ status: 'stopped', code, message: 'Worker stopped; inspect configuration and authoritative round state before resuming.' }));
  process.exitCode = 1;
});
