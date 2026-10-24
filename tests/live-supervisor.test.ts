import { describe, expect, it } from 'vitest';
import { RulesWorkerError, type RulesTickResult } from '../packages/live/src/worker.ts';
import { superviseRulesWorker, type SupervisorEvent } from '../packages/live/src/supervisor.ts';

const result = (status: RulesTickResult['status'], tick = 0): RulesTickResult =>
  ({ status, tick, sequence: tick + 1, replayed: false });

describe('persistent rules supervisor', () => {
  it('serializes paced work and observes an explicit resume from pause', async () => {
    const control = new AbortController(), sleeps: number[] = [], events: SupervisorEvent[] = [];
    const replies = [result('waiting'), result('committed'), result('paused'), result('committed', 1), result('completed', 120)];
    let calls = 0;
    await superviseRulesWorker({ signal: control.signal, tick: async () => replies[calls++]!,
      report: event => events.push(event), wait: async ms => { sleeps.push(ms); if (ms === 30_000) control.abort(); } });
    expect(calls).toBe(5); expect(sleeps).toEqual([5000, 5000, 10000, 5000, 30000]);
    expect(events.map(e => e.status)).toEqual(['waiting', 'committed', 'paused', 'committed', 'completed']);
  });
  it.each(['completed', 'stopped'] as const)('never invokes another tick after %s', async status => {
    const control = new AbortController(); let calls = 0, sleeps = 0;
    await superviseRulesWorker({ signal: control.signal, tick: async () => { calls++; return result(status); },
      report: () => {}, wait: async () => { if (++sleeps === 3) control.abort(); } });
    expect(calls).toBe(1);
  });
  it('halts after five uncertain store failures with bounded backoff', async () => {
    const control = new AbortController(), events: SupervisorEvent[] = [], sleeps: number[] = []; let calls = 0;
    await superviseRulesWorker({ signal: control.signal, tick: async () => { calls++; throw new RulesWorkerError('store'); },
      report: event => events.push(event), wait: async ms => { sleeps.push(ms); if (events.at(-1)?.status === 'halted') control.abort(); } });
    expect(calls).toBe(5); expect(sleeps).toEqual([10000, 20000, 40000, 60000, 30000]);
    expect(events.at(-1)).toEqual({ status: 'halted', reason: 'failure-limit' });
  });
  it('halts immediately on recovery corruption without exposing the error payload', async () => {
    const control = new AbortController(), events: SupervisorEvent[] = []; let calls = 0;
    await superviseRulesWorker({ signal: control.signal, tick: async () => { calls++; throw new RulesWorkerError('recovery'); },
      report: event => events.push(event), wait: async () => control.abort() });
    expect(calls).toBe(1); expect(events).toEqual([{ status: 'halted', reason: 'recovery' }]);
  });
  it('finishes an in-flight tick on shutdown and starts no further work', async () => {
    const control = new AbortController(); let finished = false, calls = 0;
    await superviseRulesWorker({ signal: control.signal, tick: async () => {
      calls++; control.abort(); await Promise.resolve(); finished = true; return result('committed');
    }, report: () => {} });
    expect(finished).toBe(true); expect(calls).toBe(1);
  });
});
