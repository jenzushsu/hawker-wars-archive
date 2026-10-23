import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRulesRoundInput, runRulesTick } from '../packages/live/src/worker.ts';
import { resolveVoteCounts, type VoteResolution } from '../packages/live/src/vote-resolution.ts';
import type { LiveCommitInput, LiveRecoveryRecord, LiveRoundStatus, LiveStore } from '../packages/live/src/store.ts';
import { canonicalState, stateHash } from '../packages/simulation/src/hash.ts';
import type { DemandSchedule } from '../packages/simulation/src/demand.ts';
import type { EngineFrame } from '../packages/simulation/src/types.ts';
import type { Observation } from '../packages/shared/src/schemas.ts';

const roundId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const otherOwner = '33333333-3333-4333-8333-333333333333';
const command = { roundId, ownerId };
const resolution = () => resolveVoteCounts({ roundId, seed: 7, effectiveTick: 31,
  counts: { bus: 0, rain: 2, 'supplier-delay': 0 } });
type Probe = { frame: EngineFrame; recentActions: Observation['recentActions']; schedule: DemandSchedule;
  resolvedSchedule: DemandSchedule | null; voteResolution: VoteResolution | null; stateHash: string; configurationHash: string };

/** Independent persistence fake: records atomic boundaries, not simulator behavior. */
class VoteStore {
  record: LiveRecoveryRecord;
  durableResolution: VoteResolution | null = null;
  resolutionResponse: unknown = undefined;
  attempted: LiveCommitInput[] = [];
  fence = 1;
  owner = ownerId;
  loseResolutionAck = false;
  loseCommitAck = false;
  pauseAtRenew = false;
  constructor(record?: LiveRecoveryRecord) {
    const created = createRulesRoundInput(roundId, 7, true, true);
    this.record = record ? structuredClone(record) : { schemaVersion: 'live-recovery-1', round_id: roundId,
      classification: created.classification, policy_ids: [...created.policyIds], status: 'running',
      control_state: 'active', control_revision: 0, tick: -1, sequence: 0,
      configuration_hash: created.configurationHash, schedule_hash: created.scheduleHash,
      recovery: structuredClone(created.recovery) };
  }
  getRoundStatus = vi.fn(async (): Promise<LiveRoundStatus> => {
    const { recovery: _private, schemaVersion: _version, ...metadata } = this.record;
    return structuredClone({ schemaVersion: 'live-round-status-1', ...metadata, ready: metadata.control_state === 'active' });
  });
  acquireLease = vi.fn(async (input: Parameters<LiveStore['acquireLease']>[0]) => {
    if (input.ownerId !== this.owner) { this.owner = input.ownerId; this.fence++; }
    return { fence: this.fence, expires_at: '2099-01-01T00:00:00.000Z' };
  });
  getRecovery = vi.fn(async () => structuredClone(this.record));
  resolveVoteWindow = vi.fn(async () => {
    this.durableResolution ??= resolution();
    if (this.loseResolutionAck) { this.loseResolutionAck = false; throw new Error('private-lost-resolution-ack'); }
    return structuredClone(this.resolutionResponse === undefined ? this.durableResolution : this.resolutionResponse) as VoteResolution | null;
  });
  renewLease = vi.fn(async () => {
    if (this.pauseAtRenew) { this.record.control_state = 'paused'; this.fence++; throw new Error('private-pause-race'); }
    return { fence: this.fence, expires_at: '2099-01-01T00:00:00.000Z' };
  });
  releaseLease = vi.fn(async () => true);
  commitTick = vi.fn(async (input: LiveCommitInput) => {
    this.attempted.push(structuredClone(input));
    if (input.fence !== this.fence || input.ownerId !== this.owner || this.record.control_state !== 'active') throw new Error('stale lease');
    if (input.expectedSequence !== this.record.sequence || input.tick !== this.record.tick + 1) throw new Error('stale boundary');
    this.record.tick = input.tick; this.record.sequence++;
    this.record.status = input.tick === 120 ? 'completed' : 'running';
    this.record.recovery = structuredClone(input.recovery);
    if (this.loseCommitAck) { this.loseCommitAck = false; throw new Error('private-lost-commit-ack'); }
    return { round_id: roundId, tick: input.tick, sequence: this.record.sequence, replayed: false };
  });
}
let tick30: LiveRecoveryRecord;
beforeAll(async () => {
  const store = new VoteStore();
  for (let tick = 0; tick <= 30; tick++) await runRulesTick(store, command);
  tick30 = structuredClone(store.record);
});
function refreshStateHash(store: VoteStore) {
  const saved = store.record.recovery as unknown as Probe;
  const schedule = saved.resolvedSchedule ?? saved.schedule;
  saved.stateHash = stateHash({ frame: saved.frame, recentActions: saved.recentActions,
    scheduleHash: schedule.hash, scenario: schedule.scenario, configurationHash: saved.configurationHash });
}

describe('independent voting worker recovery and resolution review', () => {
  it('rejects altered resolution identity, winner, counts, tie evidence and application boundaries before commit', async () => {
    const tie = resolveVoteCounts({ roundId, seed: 7, effectiveTick: 31, counts: { bus: 1, rain: 1, 'supplier-delay': 1 } });
    const wrongSeed = resolveVoteCounts({ roundId, seed: 8, effectiveTick: 31, counts: tie.counts });
    for (const bad of [
      { ...resolution(), round_id: otherOwner }, { ...resolution(), winner: 'bus' },
      { ...resolution(), counts: { bus: 3, rain: 2, 'supplier-delay': 0 } },
      { ...resolution(), effective_tick: 30 }, { ...resolution(), effective_tick: 32 },
      { ...tie, draw_digest: '0'.repeat(64) }, wrongSeed,
    ]) {
      const store = new VoteStore(tick30); store.resolutionResponse = bad;
      await expect(runRulesTick(store, command)).rejects.toMatchObject({ code: 'recovery' });
      expect(store.commitTick).not.toHaveBeenCalled();
      expect(store.record.tick).toBe(30);
    }
  });

  it('recovers a persisted resolution after its acknowledgement is lost without advancing or resolving twice', async () => {
    const store = new VoteStore(tick30); store.loseResolutionAck = true;
    const failed = await runRulesTick(store, command).catch(error => error);
    expect(failed).toMatchObject({ code: 'store' });
    expect(String(failed)).not.toContain('private-lost-resolution-ack');
    expect(store.resolveVoteWindow).toHaveBeenCalledTimes(1);
    expect(store.commitTick).not.toHaveBeenCalled();
    expect(store.record.tick).toBe(30);
    const durable = structuredClone(store.durableResolution);
    await expect(runRulesTick(store, { roundId, ownerId: otherOwner })).resolves.toMatchObject({ tick: 31 });
    expect(store.durableResolution).toEqual(durable);
    expect(store.record.recovery.voteResolution).toEqual(durable);
    expect((store.record.recovery.frame as EngineFrame).appliedEvents).toHaveLength(1);
  });

  it('never reapplies an effect when the application commit acknowledgement is lost', async () => {
    const store = new VoteStore(tick30); store.loseCommitAck = true;
    await expect(runRulesTick(store, command)).rejects.toMatchObject({ code: 'store' });
    expect(store.attempted).toHaveLength(1);
    expect(store.record.tick).toBe(31);
    await runRulesTick(store, { roundId, ownerId: otherOwner });
    expect(store.attempted.map(value => value.tick)).toEqual([31, 32]);
    expect((store.record.recovery.frame as EngineFrame).appliedEvents).toEqual([
      expect.objectContaining({ id: `vote:${roundId}:0`, type: 'rain', effectiveTick: 31 }),
    ]);
  });

  it('rejects a changed resolved schedule even with a valid schedule checksum and recomputed state checksum', async () => {
    const store = new VoteStore(tick30); await runRulesTick(store, command);
    const saved = store.record.recovery as unknown as Probe;
    const schedule = saved.resolvedSchedule!;
    const potential = schedule.ticks[90]![0]! as { patience: number; deadlineTick: number };
    const delta = potential.patience === 10 ? -1 : 1;
    potential.patience += delta; potential.deadlineTick += delta;
    const { hash: _hash, ...contents } = schedule;
    (schedule as { hash: string }).hash = createHash('sha256').update('hawker-wars|demand-1|schedule\n').update(canonicalState(contents)).digest('hex');
    refreshStateHash(store);
    await expect(runRulesTick(store, command)).rejects.toMatchObject({ code: 'recovery' });
    expect(store.attempted).toHaveLength(1);
  });

  it('rejects resolution history that differs from the authoritative durable record even when the effect is identical', async () => {
    const store = new VoteStore(tick30); await runRulesTick(store, command);
    const saved = store.record.recovery as unknown as Probe;
    saved.voteResolution!.counts.rain++;
    refreshStateHash(store);
    await expect(runRulesTick(store, command)).rejects.toMatchObject({ code: 'recovery' });
    expect(store.attempted).toHaveLength(1);
  });

  it('requires durable resolution evidence to remain present after application', async () => {
    const store = new VoteStore(tick30); await runRulesTick(store, command);
    store.resolutionResponse = null;
    await expect(runRulesTick(store, command)).rejects.toMatchObject({ code: 'recovery' });
    expect(store.attempted).toHaveLength(1);
  });

  it('preserves a pending resolution through an operator pause without applying an unfenced tick', async () => {
    const store = new VoteStore(tick30); store.pauseAtRenew = true;
    await expect(runRulesTick(store, command)).rejects.toMatchObject({ code: 'store' });
    expect(store.durableResolution).toEqual(resolution());
    expect(store.record.tick).toBe(30);
    expect(store.commitTick).not.toHaveBeenCalled();
    await expect(runRulesTick(store, command)).resolves.toMatchObject({ status: 'paused' });
    store.pauseAtRenew = false; store.record.control_state = 'active';
    await runRulesTick(store, { roundId, ownerId: otherOwner });
    expect(store.record.tick).toBe(31);
    expect((store.record.recovery.frame as EngineFrame).appliedEvents).toHaveLength(1);
  });

  it('rejects partially persisted or prematurely applied recovery resolution fields', async () => {
    for (const mutation of [(saved: Record<string, unknown>) => { saved.voteResolution = resolution(); },
      (saved: Record<string, unknown>) => { saved.resolvedSchedule = saved.schedule; },
      (saved: Record<string, unknown>) => { saved.voteWorkerVersion = 'unknown'; }]) {
      const store = new VoteStore(tick30); mutation(store.record.recovery);
      await expect(runRulesTick(store, command)).rejects.toMatchObject({ code: 'recovery' });
      expect(store.resolveVoteWindow).not.toHaveBeenCalled();
      expect(store.commitTick).not.toHaveBeenCalled();
    }
  });
});
