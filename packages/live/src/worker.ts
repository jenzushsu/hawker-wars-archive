import { createHash } from 'node:crypto';
import { z } from 'zod';
import { configurationHash } from '../../../scripts/config-snapshot.ts';
import { CONTRACT_VERSIONS } from '../../shared/src/config.ts';
import { ActionSummarySchema, ContractVersionsSchema, HashSchema } from '../../shared/src/schemas.ts';
import { chooseRules } from '../../decisions/src/rules.ts';
import { createInitialFrame, prepareTick, applyAction, advanceTick, settle } from '../../simulation/src/engine.ts';
import { createDemandSchedule, arrivalsAt, toEngineArrival, eventAt, type DemandSchedule } from '../../simulation/src/demand.ts';
import { getLegalActions } from '../../simulation/src/legality.ts';
import { canonicalState, stateHash } from '../../simulation/src/hash.ts';
import { scoreState } from '../../simulation/src/scoring.ts';
import { FrameSchema, StoredScheduleSchema } from '../../replay/src/schema.ts';
import type { EngineFrame } from '../../simulation/src/types.ts';
import type { Observation } from '../../shared/src/schemas.ts';
import type { LiveCreateInput, LiveStore } from './store.ts';
import { ResolutionSchema, resolveVoteCounts, applyVoteResolution } from './vote-resolution.ts';

const bounded = (min: number, max: number) => z.number().int().safe().min(min).max(max).refine(value => !Object.is(value, -0));
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const boundary = bounded(-1, 120);
const sequence = bounded(0, 121);
const optionsSchema = z.object({ roundId: uuid, ownerId: uuid, ttlSeconds: bounded(1, 60).default(30) }).strict();
const metadataFields = {
  round_id: uuid, classification: z.literal('exhibition'), policy_ids: z.tuple([z.literal('rules')]),
  status: z.enum(['running', 'completed']), tick: boundary, sequence,
  control_state: z.enum(['active', 'paused', 'stopped']), control_revision: bounded(0, Number.MAX_SAFE_INTEGER),
  configuration_hash: HashSchema, schedule_hash: HashSchema,
};
const statusSchema = z.object({ ...metadataFields, schemaVersion: z.literal('live-round-status-1'), ready: z.boolean() }).strict();
const commonRecovery = {
  schemaVersion: z.literal('recovery-1'), workerVersion: z.literal('rules-worker-1'), roundId: uuid,
  contracts: ContractVersionsSchema, configurationHash: HashSchema,
  schedule: StoredScheduleSchema, committedTick: boundary, sequence, frame: FrameSchema,
  recentActions: z.array(ActionSummarySchema).max(5), stateHash: HashSchema,
};
const recoverySchema = z.discriminatedUnion('votingEnabled', [
  z.object({ ...commonRecovery, votingEnabled: z.literal(false) }).strict(),
  z.object({ ...commonRecovery, votingEnabled: z.literal(true), voteWorkerVersion: z.literal('rules-voting-1'),
    voteResolution: ResolutionSchema.nullable(), resolvedSchedule: StoredScheduleSchema.nullable() }).strict(),
]);
const recordSchema = z.object({ ...metadataFields, schemaVersion: z.literal('live-recovery-1'), recovery: recoverySchema }).strict();
export type RulesRecovery = z.infer<typeof recoverySchema>;
export type RulesWorkerStore = Pick<LiveStore, 'getRoundStatus' | 'acquireLease' | 'getRecovery' | 'renewLease' | 'commitTick' | 'releaseLease'> & Partial<Pick<LiveStore, 'resolveVoteWindow'>>;
export interface RulesTickResult { status: 'committed' | 'completed' | 'waiting' | 'paused' | 'stopped'; tick: number; sequence: number; replayed: boolean }
export class RulesWorkerError extends Error {
  constructor(readonly code: 'input' | 'recovery' | 'store') { super(`Rules worker ${code} failure`); this.name = 'RulesWorkerError'; }
}
function fail(): never { throw new RulesWorkerError('recovery'); }
function metadata(value: z.infer<typeof statusSchema> | z.infer<typeof recordSchema>, roundId: string): void {
  if (value.round_id !== roundId || value.configuration_hash !== configurationHash || value.sequence !== value.tick + 1 || (value.status === 'completed') !== (value.tick === 120)) fail();
}
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, code: 'input' | 'recovery'): z.output<S> {
  try { return schema.parse(value); } catch { throw new RulesWorkerError(code); }
}
interface ReplayPosition { frame: EngineFrame; recentActions: Observation['recentActions'] }
function hash(position: ReplayPosition, schedule: DemandSchedule): string {
  return stateHash({ ...position, scheduleHash: schedule.hash, scenario: schedule.scenario, configurationHash });
}
function step(position: ReplayPosition, schedule: DemandSchedule, tick: number): ReplayPosition {
  let frame = position.frame;
  if (frame.stage === 'committed') frame = advanceTick(frame);
  if (tick === 120) return { frame: settle(frame), recentActions: position.recentActions };
  const promotion = frame.state.promotion;
  const active = !!promotion && promotion.startsAt <= tick && promotion.endsAt >= tick;
  const arrivals = arrivalsAt(schedule, tick, active).map(toEngineArrival);
  const event = eventAt(schedule, tick);
  frame = prepareTick(frame, event ? { arrivals, event } : { arrivals });
  const action = chooseRules(frame.state, getLegalActions(frame.state)).action;
  frame = applyAction(frame, action);
  return { frame, recentActions: [...position.recentActions, { tick, action }].slice(-5) };
}
/** Replay the persisted schedule, not a newly drawn schedule. No remote controller exists here. */
function replay(schedule: DemandSchedule, tick: number): ReplayPosition {
  let position: ReplayPosition = { frame: createInitialFrame(), recentActions: [] };
  for (let index = 0; index <= tick; index++) position = step(position, schedule, index);
  return position;
}
type VoteState = { votingEnabled: false } | { votingEnabled: true; voteWorkerVersion: 'rules-voting-1';
  voteResolution: z.infer<typeof ResolutionSchema> | null; resolvedSchedule: DemandSchedule | null };
function envelope(roundId: string, schedule: DemandSchedule, tick: number, position: ReplayPosition, vote: VoteState = { votingEnabled: false }): RulesRecovery {
  const effective = vote.votingEnabled ? vote.resolvedSchedule ?? schedule : schedule;
  return parse(recoverySchema, { schemaVersion: 'recovery-1', workerVersion: 'rules-worker-1', roundId,
    contracts: CONTRACT_VERSIONS, configurationHash, ...vote, schedule,
    committedTick: tick, sequence: tick + 1, ...position, stateHash: hash(position, effective) }, 'recovery');
}
function verifyResolution(value: z.infer<typeof ResolutionSchema>, roundId: string, seed: number): void {
  const expected = resolveVoteCounts({ roundId, seed, effectiveTick: value.effective_tick, counts: value.counts });
  if (canonicalState(value) !== canonicalState(expected)) fail();
}
/** Creates a development-seed, clean, one-policy exhibition. Voting is explicit opt-in; model dispatch stays disabled. */
export function createRulesRoundInput(roundId: string, seed: number, published = false, votingEnabled = false): LiveCreateInput {
  const input = parse(z.object({ roundId: uuid, seed: bounded(0, 99), published: z.boolean(), votingEnabled: z.boolean() }).strict(), { roundId, seed, published, votingEnabled }, 'input');
  const schedule = createDemandSchedule(input.seed, 'clean');
  const vote: VoteState = input.votingEnabled ? { votingEnabled: true, voteWorkerVersion: 'rules-voting-1', voteResolution: null, resolvedSchedule: null } : { votingEnabled: false };
  return { roundId: input.roundId, classification: 'exhibition', policyIds: ['rules'], configurationHash,
    scheduleHash: schedule.hash, recovery: envelope(input.roundId, schedule, -1, replay(schedule, -1), vote), published: input.published };
}
/** Stable per-boundary commit identity, independent of lease owner, retry time or process lifetime. */
export function rulesCommitKey(roundId: string, tick: number, scheduleHash: string): string {
  parse(z.object({ roundId: uuid, tick: bounded(0, 120), scheduleHash: HashSchema }).strict(), { roundId, tick, scheduleHash }, 'input');
  const chars = createHash('sha256').update(`hawker-wars|rules-worker-1|${roundId}|${configurationHash}|${scheduleHash}|${tick}`).digest('hex').slice(0, 32).split('');
  chars[12] = '8'; chars[16] = '8'; const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** One bounded tick. Database pacing and fencing remain authoritative. No local progress survives failure.
 * A lost response is never blindly retried here; the next invocation reloads the durable boundary.
 */
export async function runRulesTick(store: RulesWorkerStore, input: z.input<typeof optionsSchema>): Promise<RulesTickResult> {
  const options = parse(optionsSchema, input, 'input');
  let ownership: { roundId: string; ownerId: string; fence: number } | null = null;
  try {
    const status = parse(statusSchema, await store.getRoundStatus(options.roundId), 'recovery');
    metadata(status, options.roundId);
    if (status.status === 'completed') return { status: 'completed', tick: 120, sequence: 121, replayed: false };
    if (status.control_state !== 'active') return { status: status.control_state, tick: status.tick, sequence: status.sequence, replayed: false };
    if (!status.ready) return { status: 'waiting', tick: status.tick, sequence: status.sequence, replayed: false };
    const lease = await store.acquireLease(options);
    ownership = { roundId: options.roundId, ownerId: options.ownerId, fence: lease.fence };
    const record = parse(recordSchema, await store.getRecovery(ownership), 'recovery');
    metadata(record, options.roundId);
    const saved = record.recovery;
    if (record.status !== 'running' || record.control_state !== 'active' || saved.roundId !== options.roundId || saved.configurationHash !== configurationHash ||
      saved.committedTick !== record.tick || saved.sequence !== record.sequence || saved.schedule.hash !== record.schedule_hash ||
      saved.schedule.scenario !== 'clean' || saved.schedule.shock !== null || saved.schedule.seed > 99 || status.schedule_hash !== record.schedule_hash) fail();
    let effective: DemandSchedule = saved.schedule;
    let vote: VoteState = { votingEnabled: false };
    if (saved.votingEnabled) {
      vote = { votingEnabled: true, voteWorkerVersion: saved.voteWorkerVersion, voteResolution: saved.voteResolution, resolvedSchedule: saved.resolvedSchedule };
      if ((saved.voteResolution === null) !== (saved.resolvedSchedule === null)) fail();
      if (saved.voteResolution !== null) {
        verifyResolution(saved.voteResolution, options.roundId, saved.schedule.seed);
        if (saved.voteResolution.effective_tick > record.tick) fail();
        const expected = applyVoteResolution(saved.schedule, saved.voteResolution);
        if (canonicalState(expected) !== canonicalState(saved.resolvedSchedule)) fail();
        effective = saved.resolvedSchedule!;
      }
    }
    const position = replay(effective, record.tick);
    if (saved.stateHash !== hash(position, effective) || canonicalState(saved.frame) !== canonicalState(position.frame) ||
      canonicalState(saved.recentActions) !== canonicalState(position.recentActions)) fail();
    const tick = record.tick + 1;
    if (vote.votingEnabled && record.tick >= 30) {
      if (!store.resolveVoteWindow) throw new RulesWorkerError('store');
      const resolved = parse(ResolutionSchema.nullable(), await store.resolveVoteWindow(ownership), 'recovery');
      if (vote.voteResolution !== null) {
        if (canonicalState(resolved) !== canonicalState(vote.voteResolution)) fail();
      } else if (resolved !== null) {
        verifyResolution(resolved, options.roundId, saved.schedule.seed);
        if (resolved.effective_tick !== tick) fail();
        effective = applyVoteResolution(saved.schedule, resolved);
        vote = { ...vote, voteResolution: resolved, resolvedSchedule: effective };
      }
      if (tick === 120 && vote.voteResolution === null) fail();
    }
    const next = step(position, effective, tick);
    const score = scoreState(next.frame.state);
    const snapshot = { policies: [{ policy_id: 'rules' as const, cash_cents: next.frame.state.cashCents,
      profit_cents: score.profitCents, utility_points: score.utilityPoints,
      served: next.frame.state.totals.served, abandoned: next.frame.state.totals.abandoned,
      activity: {
        queue: next.frame.state.queue.length,
        queuePoses: next.frame.state.queue.slice(0, 3).map(customer => customer.arrivalTick === tick ? 'walk' as const : customer.deadlineTick - tick <= 1 ? 'impatient' as const : 'wait' as const),
        received: next.frame.state.totals.served - position.frame.state.totals.served,
        departed: next.frame.state.totals.abandoned - position.frame.state.totals.abandoned,
        cooking: next.frame.state.cooking !== null,
        ready: next.frame.state.readyBatches.reduce((sum, batch) => sum + batch.quantity, 0),
        raw: next.frame.state.rawPortions,
        action: tick === 120 ? null : next.recentActions.at(-1)!.action,
      } }] };
    const decisions = tick === 120 ? [] : [{ policy_id: 'rules' as const, action: next.recentActions.at(-1)!.action,
      source: 'rules' as const, fallback_reason: null }];
    await store.renewLease({ ...ownership, ttlSeconds: options.ttlSeconds });
    const committed = await store.commitTick({ ...ownership, expectedSequence: record.sequence, tick,
      commitKey: rulesCommitKey(options.roundId, tick, effective.hash), snapshot, decisions,
      recovery: envelope(options.roundId, saved.schedule, tick, next, vote) });
    if (committed.round_id !== options.roundId || committed.tick !== tick || committed.sequence !== tick + 1 || typeof committed.replayed !== 'boolean') fail();
    return { status: tick === 120 ? 'completed' : 'committed', tick, sequence: committed.sequence, replayed: committed.replayed };
  } catch (error) {
    if (error instanceof RulesWorkerError) throw error;
    throw new RulesWorkerError('store');
  } finally {
    // Release is awaited but cannot invalidate a durable commit or mask its primary failure.
    // If release is uncertain, database expiry/fencing remains the recovery path.
    if (ownership !== null) { try { await store.releaseLease(ownership); } catch { /* lease expires */ } }
  }
}
