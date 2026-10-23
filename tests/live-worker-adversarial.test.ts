import { describe, expect, it, vi } from 'vitest';
import { createRulesRoundInput, runRulesTick } from '../packages/live/src/worker.ts';
import type { LiveCommitInput, LiveRecoveryRecord, LiveRoundStatus, LiveStore } from '../packages/live/src/store.ts';
import type { EngineFrame } from '../packages/simulation/src/types.ts';
import type { DemandSchedule } from '../packages/simulation/src/demand.ts';
import type { Observation } from '../packages/shared/src/schemas.ts';
import { stateHash } from '../packages/simulation/src/hash.ts';

const roundId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const otherOwner = '33333333-3333-4333-8333-333333333333';
const input = { roundId, ownerId };
type RecoveryProbe = {
  frame: EngineFrame; recentActions: Observation['recentActions']; schedule: DemandSchedule;
  configurationHash: string; stateHash: string;
};

/** Independent stateful fake models only the authoritative store boundary, never engine choices. */
class AuthoritativeStore {
  record: LiveRecoveryRecord;
  attempted: LiveCommitInput[] = [];
  acknowledged: LiveCommitInput[] = [];
  fence = 1;
  owner = ownerId;
  failBeforeCommit = false;
  loseCommitResponse = false;
  loseLeaseOnRenew = false;
  constructor() {
    const created = createRulesRoundInput(roundId, 7);
    this.record = {
      schemaVersion: 'live-recovery-1', round_id: roundId, classification: created.classification,
      policy_ids: [...created.policyIds], status: 'running', control_state: 'active' as const, control_revision: 0, tick: -1, sequence: 0,
      configuration_hash: created.configurationHash, schedule_hash: created.scheduleHash,
      recovery: structuredClone(created.recovery),
    };
  }
  getRoundStatus = vi.fn(async (): Promise<LiveRoundStatus> => {
    const { recovery: _private, schemaVersion: _version, ...metadata } = this.record;
    return structuredClone({ schemaVersion: 'live-round-status-1', ...metadata, ready: true });
  });
  acquireLease = vi.fn(async (request: Parameters<LiveStore['acquireLease']>[0]) => {
    if (request.ownerId !== this.owner) { this.owner = request.ownerId; this.fence++; }
    return { fence: this.fence, expires_at: '2099-01-01T00:00:00.000Z' };
  });
  renewLease = vi.fn(async (request: Parameters<LiveStore['renewLease']>[0]) => {
    if (this.loseLeaseOnRenew) { this.owner = otherOwner; this.fence++; throw new Error('private-renew-diagnostic'); }
    if (request.ownerId !== this.owner || request.fence !== this.fence) throw new Error('stale lease');
    return { fence: this.fence, expires_at: '2099-01-01T00:00:00.000Z' };
  });
  releaseLease = vi.fn(async () => true);
  getRecovery = vi.fn(async () => structuredClone(this.record));
  commitTick = vi.fn(async (request: LiveCommitInput) => {
    this.attempted.push(structuredClone(request));
    if (this.failBeforeCommit || request.ownerId !== this.owner || request.fence !== this.fence) throw new Error('private-commit-diagnostic');
    if (request.expectedSequence !== this.record.sequence || request.tick !== this.record.tick + 1) throw new Error('boundary conflict');
    this.record.tick = request.tick;
    this.record.sequence = request.expectedSequence + 1;
    this.record.status = request.tick === 120 ? 'completed' : 'running';
    this.record.recovery = structuredClone(request.recovery);
    this.acknowledged.push(structuredClone(request));
    if (this.loseCommitResponse) { this.loseCommitResponse = false; throw new Error('private-lost-response'); }
    return { round_id: roundId, tick: request.tick, sequence: request.expectedSequence + 1, replayed: false };
  });
}
function recomputeRecoveryHash(store: AuthoritativeStore): void {
  const recovery = store.record.recovery as unknown as RecoveryProbe;
  recovery.stateHash = stateHash({ frame: recovery.frame, scheduleHash: recovery.schedule.hash,
    scenario: recovery.schedule.scenario, configurationHash: recovery.configurationHash, recentActions: recovery.recentActions });
}

describe('independent rules worker recovery and failure review', () => {
  it('rejects ledger-conserving frame corruption even after its state checksum is recomputed', async () => {
    const store = new AuthoritativeStore();
    const recovery = store.record.recovery as unknown as RecoveryProbe;
    recovery.frame.state.rawPortions--;
    recovery.frame.state.readyBatches[0]!.quantity++;
    recomputeRecoveryHash(store);
    await expect(runRulesTick(store, input)).rejects.toThrow();
    expect(store.commitTick).not.toHaveBeenCalled();
    expect(store.record.tick).toBe(-1);
  });

  it('rejects a different historical action with a freshly matching checksum', async () => {
    const store = new AuthoritativeStore();
    await runRulesTick(store, input);
    const recovery = store.record.recovery as unknown as RecoveryProbe;
    const prior = recovery.recentActions[0]!;
    recovery.recentActions[0] = { ...prior, action: prior.action === 'WAIT' ? 'COOK' : 'WAIT' };
    recomputeRecoveryHash(store);
    const attempts = store.attempted.length;
    await expect(runRulesTick(store, input)).rejects.toThrow();
    expect(store.attempted).toHaveLength(attempts);
    expect(store.record.sequence).toBe(1);
  });

  it('rejects fabricated event history that is excluded from the simulator checksum', async () => {
    const store = new AuthoritativeStore();
    await runRulesTick(store, input);
    const recovery = store.record.recovery as unknown as RecoveryProbe;
    recovery.frame.events.push({ type: 'action-applied', tick: 0, action: 'WAIT' });
    recomputeRecoveryHash(store);
    await expect(runRulesTick(store, input)).rejects.toThrow();
    expect(store.attempted).toHaveLength(1);
  });

  it('rejects private version, round, clock-boundary and voting mutations without writing', async () => {
    const mutations: [string, unknown][] = [
      ['schemaVersion', 'recovery-0'], ['workerVersion', 'provider-worker-1'],
      ['roundId', otherOwner], ['committedTick', 1], ['sequence', 2], ['votingEnabled', true],
      ['configurationHash', 'b'.repeat(64)], ['contracts', {}], ['extraProviderPayload', 'private-canary'],
    ];
    for (const [key, value] of mutations) {
      const store = new AuthoritativeStore();
      store.record.recovery[key] = value;
      await expect(runRulesTick(store, input)).rejects.toThrow();
      expect(store.commitTick).not.toHaveBeenCalled();
    }
  });

  it('refuses incompatible database identity, configuration and policy metadata', async () => {
    const changes: Partial<LiveRecoveryRecord>[] = [
      { round_id: otherOwner }, { classification: 'clean' }, { classification: 'replay' },
      { policy_ids: ['rules', 'jev'] }, { policy_ids: ['jev'] },
      { configuration_hash: 'b'.repeat(64) }, { schedule_hash: 'c'.repeat(64) },
      { tick: 0, sequence: 1 },
    ];
    for (const change of changes) {
      const store = new AuthoritativeStore(); Object.assign(store.record, change);
      await expect(runRulesTick(store, input)).rejects.toThrow();
      expect(store.commitTick).not.toHaveBeenCalled();
    }
  });

  it('does not regenerate or silently repair a tampered stored demand schedule', async () => {
    const store = new AuthoritativeStore();
    const recovery = store.record.recovery as unknown as RecoveryProbe;
    (recovery.schedule.ticks[0]![0]! as { patience: number }).patience++;
    await expect(runRulesTick(store, input)).rejects.toThrow();
    expect(store.commitTick).not.toHaveBeenCalled();
    expect(store.record.tick).toBe(-1);
  });

  it('recovers the authoritative next tick after a successful commit response is lost', async () => {
    const store = new AuthoritativeStore(); store.loseCommitResponse = true;
    await expect(runRulesTick(store, input)).rejects.toThrow();
    expect(store.attempted).toHaveLength(1);
    expect(store.record.sequence).toBe(1);
    expect(store.acknowledged).toHaveLength(1);
    await expect(runRulesTick(store, { roundId, ownerId: otherOwner })).resolves.toMatchObject({ tick: 1, sequence: 2 });
    expect(store.attempted.map(item => item.tick)).toEqual([0, 1]);
    expect(store.acknowledged.map(item => item.tick)).toEqual([0, 1]);
    expect(new Set(store.attempted.map(item => item.commitKey)).size).toBe(2);
  });

  it('recomputes the same deterministic commit key after failure before persistence', async () => {
    const store = new AuthoritativeStore(); store.failBeforeCommit = true;
    const before = JSON.stringify(store.record);
    const error = await runRulesTick(store, input).catch(value => value);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('private-commit-diagnostic');
    expect(store.attempted).toHaveLength(1);
    expect(JSON.stringify(store.record)).toBe(before);
    store.failBeforeCommit = false;
    await runRulesTick(store, input);
    expect(store.attempted.map(item => item.tick)).toEqual([0, 0]);
    expect(store.attempted[0]!.commitKey).toBe(store.attempted[1]!.commitKey);
    expect(store.acknowledged).toHaveLength(1);
  });

  it('stops before committing when lease renewal reports a replacement worker', async () => {
    const store = new AuthoritativeStore(); store.loseLeaseOnRenew = true;
    const before = JSON.stringify(store.record);
    await expect(runRulesTick(store, input)).rejects.toThrow();
    expect(store.renewLease).toHaveBeenCalled();
    expect(store.commitTick).not.toHaveBeenCalled();
    expect(JSON.stringify(store.record)).toBe(before);
  });

  it('performs no lease or engine work when database pacing says to wait', async () => {
    const store = new AuthoritativeStore();
    const status = await store.getRoundStatus();
    store.getRoundStatus.mockResolvedValue({ ...status, ready: false });
    await expect(runRulesTick(store, input)).resolves.toMatchObject({ status: 'waiting', tick: -1, sequence: 0 });
    expect(store.acquireLease).not.toHaveBeenCalled();
    expect(store.getRecovery).not.toHaveBeenCalled();
    expect(store.commitTick).not.toHaveBeenCalled();
  });

  it.each(['paused', 'stopped'] as const)('does no lease or simulator work for a durable %s round', async control_state => {
    const store = new AuthoritativeStore();
    store.record.control_state = control_state;
    store.record.control_revision = 3;
    const status = await store.getRoundStatus();
    store.getRoundStatus.mockResolvedValue({ ...status, ready: false });
    await expect(runRulesTick(store, input)).resolves.toEqual({ status: control_state, tick: -1, sequence: 0, replayed: false });
    expect(store.acquireLease).not.toHaveBeenCalled();
    expect(store.getRecovery).not.toHaveBeenCalled();
    expect(store.renewLease).not.toHaveBeenCalled();
    expect(store.commitTick).not.toHaveBeenCalled();
  });

  it.each(['paused', 'stopped'] as const)('rejects a concurrent %s control found after acquiring the lease', async control_state => {
    const store = new AuthoritativeStore();
    const status = await store.getRoundStatus();
    store.getRoundStatus.mockResolvedValue(status);
    store.record.control_state = control_state;
    store.record.control_revision++;
    await expect(runRulesTick(store, input)).rejects.toMatchObject({ code: 'recovery' });
    expect(store.renewLease).not.toHaveBeenCalled();
    expect(store.commitTick).not.toHaveBeenCalled();
    expect(store.releaseLease).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed commands and held-out creation seeds before any store operation', async () => {
    const store = new AuthoritativeStore();
    for (const command of [
      { ...input, roundId: 'not-a-uuid' }, { ...input, ownerId: '' },
      { ...input, roundId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
      { ...input, ownerId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },
      { ...input, ttlSeconds: 0 }, { ...input, ttlSeconds: 61 }, { ...input, seed: 1000 },
    ]) await expect(runRulesTick(store, command as never)).rejects.toThrow();
    expect(store.getRoundStatus).not.toHaveBeenCalled();
    expect(store.acquireLease).not.toHaveBeenCalled();
    for (const seed of [-1, -0, 0.5, 100, 1000, NaN, Infinity]) expect(() => createRulesRoundInput(roundId, seed)).toThrow();
    expect(() => createRulesRoundInput('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 7)).toThrow();
  });

  it('does not turn an acknowledged durable commit into failure when best-effort release fails', async () => {
    const store = new AuthoritativeStore();
    store.releaseLease.mockRejectedValue(new Error('private-release-diagnostic'));
    await expect(runRulesTick(store, input)).resolves.toMatchObject({ status: 'committed', tick: 0, sequence: 1 });
    expect(store.releaseLease).toHaveBeenCalled();
    expect(store.acknowledged).toHaveLength(1);
    expect(store.record.sequence).toBe(1);
  });

  it('uses only local rules and does not issue any provider or other fetch requests', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('Network forbidden in worker test'));
    vi.stubGlobal('fetch', fetch);
    try {
      const store = new AuthoritativeStore();
      for (let tick = 0; tick < 3; tick++) await runRulesTick(store, input);
      expect(fetch).not.toHaveBeenCalled();
      expect(store.acknowledged.every(commit => commit.decisions.length === 1 && commit.decisions[0]!.policy_id === 'rules' && commit.decisions[0]!.source === 'rules' && commit.decisions[0]!.fallback_reason === null)).toBe(true);
      const publicData = JSON.stringify(store.acknowledged.map(commit => ({ snapshot: commit.snapshot, decisions: commit.decisions })));
      expect(publicData).not.toMatch(/seed|schedule|stateHash|contracts|roundId/);
    } finally { vi.unstubAllGlobals(); }
  });
});
