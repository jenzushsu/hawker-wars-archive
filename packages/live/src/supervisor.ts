import { setTimeout as delay } from 'node:timers/promises';
import { RulesWorkerError, type RulesTickResult } from './worker.ts';

export type SupervisorEvent = RulesTickResult | { status: 'retrying'; attempt: number; delayMs: number } |
  { status: 'halted'; reason: 'recovery' | 'failure-limit' | 'unexpected' };

export async function waitForWorker(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  try { await delay(ms, undefined, { signal }); }
  catch (error) { if (!signal.aborted) throw error; }
}

/** One configured round, serial ticks, and no creation or provider dispatch.
 * Completed/stopped/halted workers stay idle so container restart policies cannot
 * turn normal completion into an endless series of round executions.
 */
export async function superviseRulesWorker(options: {
  tick: () => Promise<RulesTickResult>;
  signal: AbortSignal;
  report: (event: SupervisorEvent) => void;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const wait = options.wait ?? waitForWorker;
  let failures = 0, idle = false, previous = '';
  while (!options.signal.aborted) {
    if (idle) { await wait(30_000, options.signal); continue; }
    let result: RulesTickResult;
    try { result = await options.tick(); }
    catch (error) {
      if (options.signal.aborted) return;
      failures++;
      if (!(error instanceof RulesWorkerError) || error.code !== 'store' || failures >= 5) {
        options.report({ status: 'halted', reason: error instanceof RulesWorkerError
          ? error.code === 'store' ? 'failure-limit' : 'recovery' : 'unexpected' });
        idle = true;
        continue;
      }
      const delayMs = Math.min(60_000, 10_000 * 2 ** (failures - 1));
      options.report({ status: 'retrying', attempt: failures, delayMs });
      // The next invocation reloads durable state; uncertain writes are never
      // repeated using an in-memory tick or assumed outcome.
      await wait(delayMs, options.signal);
      continue;
    }
    failures = 0;
    const identity = `${result.status}:${result.sequence}`;
    if (identity !== previous) options.report(result);
    previous = identity;
    idle = result.status === 'completed' || result.status === 'stopped';
    if (!idle) await wait(result.status === 'paused' ? 10_000 : 5_000, options.signal);
  }
}
