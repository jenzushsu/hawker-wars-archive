import { LiveActivitySchema } from '../packages/live/src/activity.ts';
import { describe, expect, it, vi } from 'vitest';
import { createRulesRoundInput, runRulesTick, rulesCommitKey, type RulesWorkerStore } from '../packages/live/src/worker.ts';
import type { LiveCommitInput, LiveStore } from '../packages/live/src/store.ts';
import { runEpisode } from '../scripts/offline-episode.ts';

const roundId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
type RecoveryRecord = Awaited<ReturnType<LiveStore['getRecovery']>>;
function memory(seed = 7, saved?: RecoveryRecord) {
  const input = createRulesRoundInput(roundId, seed);
  let record: RecoveryRecord = saved ?? { schemaVersion: 'live-recovery-1', round_id: roundId, classification: 'exhibition', policy_ids: ['rules'], status: 'running', control_state: 'active', control_revision: 0,
    tick: -1, sequence: 0, configuration_hash: input.configurationHash, schedule_hash: input.scheduleHash, recovery: input.recovery };
  let fence = 0;
  const commits: LiveCommitInput[] = [];
  const store = {
    getRoundStatus: vi.fn(async () => { const { recovery: _, schemaVersion: __, ...status } = record; return { ...status, schemaVersion: 'live-round-status-1' as const, ready: true }; }),
    acquireLease: vi.fn(async () => ({ fence: ++fence, expires_at: '2026-10-23T12:00:30+00:00' })),
    renewLease: vi.fn(async (lease: { fence: number }) => ({ fence: lease.fence, expires_at: '2026-10-23T12:00:30+00:00' })),
    releaseLease: vi.fn(async () => true),
    getRecovery: vi.fn(async () => structuredClone(record)),
    commitTick: vi.fn(async (commit: LiveCommitInput) => {
      if (commit.expectedSequence !== record.sequence || commit.tick !== record.tick + 1) throw new Error('Boundary conflict');
      commits.push(structuredClone(commit));
      record = { ...record, tick: commit.tick, sequence: commit.tick + 1, status: commit.tick === 120 ? 'completed' : 'running', recovery: structuredClone(commit.recovery) };
      return { round_id: roundId, tick: commit.tick, sequence: commit.tick + 1, replayed: false };
    }),
  } satisfies RulesWorkerStore;
  return { store, commits, saved: () => structuredClone(record) };
}

describe('bounded rules-only worker and semantic recovery', () => {
  it('creates a private initial recovery with one rules policy, fixed versions and disabled audience voting', () => {
    const input = createRulesRoundInput(roundId, 7);
    expect(input).toMatchObject({ classification: 'exhibition', policyIds: ['rules'], published: false,
      recovery: { schemaVersion: 'recovery-1', workerVersion: 'rules-worker-1', roundId, votingEnabled: false, committedTick: -1, sequence: 0,
        schedule: { seed: 7, scenario: 'clean', shock: null }, frame: { stage: 'before-tick', boundaryTick: 0 } } });
    expect(() => createRulesRoundInput(roundId, 1000)).toThrow('input');
    expect(() => createRulesRoundInput(roundId, -0)).toThrow('input');
    expect(() => createRulesRoundInput('bad', 7)).toThrow('input');
  });
  it('computes exactly one committed action and derives aggregate public data from the engine', async () => {
    const { store, commits } = memory();
    const expected = runEpisode({ seed: 7, policy: 'rules', roundId });
    const result = await runRulesTick(store, { roundId, ownerId });
    expect(result).toEqual({ status: 'committed', tick: 0, sequence: 1, replayed: false });
    expect(commits).toHaveLength(1);
    expect(commits[0]!.decisions).toEqual([{ policy_id: 'rules', action: expected.trace[0]!.decision.appliedAction, source: 'rules', fallback_reason: null }]);
    expect(commits[0]!.recovery.stateHash).toBe(expected.trace[0]!.hash);
    expect(JSON.stringify(commits[0]!.snapshot)).not.toMatch(/seed|schedule|recovery|private|owner|fence/);
    const activity = LiveActivitySchema.parse(commits[0]!.snapshot.policies[0]!.activity);
    expect(activity.queue).toBe(expected.trace[0]!.observation.queue.length - activity.received);
    expect(activity.queuePoses).toEqual(Array(Math.min(3, activity.queue)).fill('walk'));
    expect(activity.received).toBe(commits[0]!.snapshot.policies[0]!.served);
    expect(activity.departed).toBe(commits[0]!.snapshot.policies[0]!.abandoned);
    expect(() => LiveActivitySchema.parse({ ...activity, customerIds: ['private'] })).toThrow();
    expect(() => LiveActivitySchema.parse({ ...activity, queue: 31 })).toThrow();
    expect(store.renewLease).toHaveBeenCalledTimes(1);
    expect(store.releaseLease).toHaveBeenCalledTimes(1);
  });
  it('restores fresh process state and reaches the same closing score/hash as the independent offline runner', async () => {
    let state = memory(7);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network controller is allowed'); }));
    try {
      for (let tick = 0; tick <= 120; tick++) {
        if (tick === 31 || tick === 89) state = memory(7, state.saved());
        const result = await runRulesTick(state.store, { roundId, ownerId });
        expect(LiveActivitySchema.safeParse(state.commits.at(-1)!.snapshot.policies[0]!.activity).success).toBe(true);
        expect(result).toMatchObject({ tick, sequence: tick + 1, status: tick === 120 ? 'completed' : 'committed' });
      }
      const expected = runEpisode({ seed: 7, policy: 'rules', roundId });
      const saved = state.saved();
      expect(saved.recovery.stateHash).toBe(expected.finalHash);
      expect(saved.recovery.frame).toMatchObject({ state: expected.finalState, stage: 'closed', boundaryTick: 120 });
      expect(state.commits.at(-1)!.snapshot.policies[0]).toMatchObject({ profit_cents: expected.score.profitCents, utility_points: expected.score.utilityPoints,
        served: expected.finalState.totals.served, abandoned: expected.finalState.totals.abandoned });
      expect(state.commits.at(-1)!.decisions).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
      const before = state.store.acquireLease.mock.calls.length;
      expect(await runRulesTick(state.store, { roundId, ownerId })).toMatchObject({ status: 'completed', tick: 120, sequence: 121 });
      expect(state.store.acquireLease).toHaveBeenCalledTimes(before);
    } finally { vi.unstubAllGlobals(); }
  }, 30_000);
  it('uses a stable boundary key across owner/process changes and separates distinct rounds or ticks', () => {
    const schedule = createRulesRoundInput(roundId, 7).scheduleHash;
    const key = rulesCommitKey(roundId, 0, schedule);
    expect(rulesCommitKey(roundId, 0, schedule)).toBe(key);
    expect(rulesCommitKey(roundId, 1, schedule)).not.toBe(key);
    expect(rulesCommitKey(ownerId, 0, schedule)).not.toBe(key);
    expect(key).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  });
  it('does not commit when the fence cannot be renewed, and sanitizes the storage failure', async () => {
    const { store, commits } = memory();
    store.renewLease.mockRejectedValueOnce(new Error('private-diagnostic-canary'));
    await expect(runRulesTick(store, { roundId, ownerId })).rejects.toMatchObject({ code: 'store', message: 'Rules worker store failure' });
    expect(commits).toEqual([]);
    expect(store.releaseLease).toHaveBeenCalledTimes(1);
  });
  it('does not turn uncertain release into an uncommitted result after a successful durable write', async () => {
    const { store, commits } = memory();
    store.releaseLease.mockRejectedValueOnce(new Error('connection lost'));
    await expect(runRulesTick(store, { roundId, ownerId })).resolves.toMatchObject({ tick: 0, sequence: 1, status: 'committed' });
    expect(commits).toHaveLength(1);
  });
});
