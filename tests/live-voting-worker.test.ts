import { describe, expect, it, vi } from 'vitest';
import { createRulesRoundInput, runRulesTick, type RulesWorkerStore } from '../packages/live/src/worker.ts';
import { resolveVoteCounts, applyVoteResolution, type VoteResolution } from '../packages/live/src/vote-resolution.ts';
import type { LiveCommitInput, LiveStore } from '../packages/live/src/store.ts';
import { createInitialFrame, prepareTick, applyAction, advanceTick, settle } from '../packages/simulation/src/engine.ts';
import { arrivalsAt, eventAt, toEngineArrival, type DemandSchedule } from '../packages/simulation/src/demand.ts';
import { decisionInput } from '../packages/simulation/src/observation.ts';
import { decideOffline } from '../packages/decisions/src/index.ts';
import { stateHash } from '../packages/simulation/src/hash.ts';
import { scoreState } from '../packages/simulation/src/scoring.ts';
import type { Observation } from '../packages/shared/src/schemas.ts';
import { configurationHash } from '../scripts/config-snapshot.ts';

const roundId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
type RecoveryRecord = Awaited<ReturnType<LiveStore['getRecovery']>>;
function memory(counts: VoteResolution['counts'], saved?: RecoveryRecord, resolved?: VoteResolution | null) {
  const input = createRulesRoundInput(roundId, 7, true, true);
  let record: RecoveryRecord = saved ?? { schemaVersion: 'live-recovery-1', round_id: roundId, classification: 'exhibition', policy_ids: ['rules'], status: 'running', control_state: 'active', control_revision: 0,
    tick: -1, sequence: 0, configuration_hash: input.configurationHash, schedule_hash: input.scheduleHash, recovery: input.recovery };
  let resolution = resolved ?? null;
  let fence = 0;
  const commits: LiveCommitInput[] = [];
  const store = {
    getRoundStatus: vi.fn(async () => { const { recovery: _, schemaVersion: __, ...status } = record; return { ...status, schemaVersion: 'live-round-status-1' as const, ready: true }; }),
    acquireLease: vi.fn(async () => ({ fence: ++fence, expires_at: '2026-10-23T12:00:30+00:00' })),
    renewLease: vi.fn(async (lease: { fence: number }) => ({ fence: lease.fence, expires_at: '2026-10-23T12:00:30+00:00' })),
    releaseLease: vi.fn(async () => true),
    getRecovery: vi.fn(async () => structuredClone(record)),
    resolveVoteWindow: vi.fn(async () => {
      if (resolution === null && record.tick >= 34) resolution = resolveVoteCounts({ roundId, seed: 7, effectiveTick: record.tick + 1, counts });
      return structuredClone(resolution);
    }),
    commitTick: vi.fn(async (commit: LiveCommitInput) => {
      if (commit.expectedSequence !== record.sequence || commit.tick !== record.tick + 1) throw new Error('Boundary conflict');
      commits.push(structuredClone(commit));
      record = { ...record, tick: commit.tick, sequence: commit.tick + 1, status: commit.tick === 120 ? 'completed' : 'running', recovery: structuredClone(commit.recovery) };
      return { round_id: roundId, tick: commit.tick, sequence: commit.tick + 1, replayed: false };
    }),
  } satisfies RulesWorkerStore;
  return { store, commits, saved: () => structuredClone(record), resolution: () => structuredClone(resolution) };
}
// Independent offline execution drives the public engine/decision contract directly.
// It consumes a stored resolved schedule and never asks the live worker for its actions.
function offline(schedule: DemandSchedule) {
  let frame = createInitialFrame(), recentActions: Observation['recentActions'] = [];
  for (let tick = 0; tick < 120; tick++) {
    const promotion = frame.state.promotion;
    const active = !!promotion && promotion.startsAt <= tick && promotion.endsAt >= tick;
    const event = eventAt(schedule, tick), arrivals = arrivalsAt(schedule, tick, active).map(toEngineArrival);
    frame = prepareTick(frame, event ? { arrivals, event } : { arrivals });
    const decision = decideOffline(decisionInput(frame.state, roundId, recentActions), { mode: 'rules' });
    frame = applyAction(frame, decision.appliedAction);
    recentActions = [...recentActions, { tick, action: decision.appliedAction }].slice(-5);
    frame = advanceTick(frame);
  }
  frame = settle(frame);
  return { frame, score: scoreState(frame.state), hash: stateHash({ frame, recentActions, scheduleHash: schedule.hash, scenario: schedule.scenario, configurationHash }) };
}

describe('rules worker with durable vote effects', () => {
  it('requires explicit opt-in and versioned initial vote recovery, preserving the clean base schedule', () => {
    expect(createRulesRoundInput(roundId, 7).recovery.votingEnabled).toBe(false);
    const input = createRulesRoundInput(roundId, 7, true, true);
    expect(input.recovery).toMatchObject({ votingEnabled: true, voteWorkerVersion: 'rules-voting-1', voteResolution: null, resolvedSchedule: null,
      schedule: { scenario: 'clean', shock: null } });
    expect(input.scheduleHash).toBe((input.recovery.schedule as DemandSchedule).hash);
  });
  it.each([
    { name: 'bus', counts: { bus: 2, rain: 0, 'supplier-delay': 0 } },
    { name: 'rain', counts: { bus: 0, rain: 2, 'supplier-delay': 0 } },
    { name: 'supplier-delay', counts: { bus: 0, rain: 0, 'supplier-delay': 2 } },
    { name: 'no votes', counts: { bus: 0, rain: 0, 'supplier-delay': 0 } },
    { name: 'three-way tie', counts: { bus: 1, rain: 1, 'supplier-delay': 1 } },
  ])('matches independent recorded-schedule execution for $name across restarts and closing', async ({ counts }) => {
    let state = memory(counts);
    const base = structuredClone(state.saved().recovery.schedule) as DemandSchedule;
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No provider calls permitted'); }));
    try {
      for (let tick = 0; tick <= 120; tick++) {
        if ([31, 35, 36, 90].includes(tick)) state = memory(counts, state.saved(), state.resolution());
        await expect(runRulesTick(state.store, { roundId, ownerId })).resolves.toMatchObject({ tick, sequence: tick + 1 });
        const saved = state.saved();
        if (tick < 35) expect(saved.recovery.voteResolution).toBeNull();
        else expect(saved.recovery.voteResolution).toEqual(state.resolution());
        expect(saved.schedule_hash).toBe(base.hash);
        expect(saved.recovery.schedule).toEqual(base);
      }
      const resolution = state.resolution()!;
      const effective = applyVoteResolution(base, resolution);
      const expected = offline(effective);
      const saved = state.saved();
      expect(saved.recovery.frame).toEqual(expected.frame);
      expect(saved.recovery.stateHash).toBe(expected.hash);
      expect(saved.recovery.resolvedSchedule).toEqual(effective);
      expect(expected.frame.appliedEvents).toHaveLength(resolution.winner === null ? 0 : 1);
      expect(state.commits.at(-1)!.snapshot.policies[0]).toMatchObject({ profit_cents: expected.score.profitCents, utility_points: expected.score.utilityPoints });
      expect(state.commits.at(-1)!.decisions).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  }, 30_000);
});
