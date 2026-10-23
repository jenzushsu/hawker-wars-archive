import { createHash } from 'node:crypto';
import { z } from 'zod';
import { configurationHash } from '../../../scripts/config-snapshot.ts';
import { CONTRACT_VERSIONS } from '../../shared/src/config.ts';
import { ActionSummarySchema, ContractVersionsSchema, HashSchema } from '../../shared/src/schemas.ts';
import { chooseRules } from '../../decisions/src/rules.ts';
import { createInitialFrame, prepareTick, applyAction, advanceTick, settle } from '../../simulation/src/engine.ts';
import { createDemandSchedule, arrivalsAt, toEngineArrival, type DemandSchedule } from '../../simulation/src/demand.ts';
import { getLegalActions } from '../../simulation/src/legality.ts';
import { canonicalState, stateHash } from '../../simulation/src/hash.ts';
import { scoreState } from '../../simulation/src/scoring.ts';
import { FrameSchema, StoredScheduleSchema } from '../../replay/src/schema.ts';
import type { EngineFrame } from '../../simulation/src/types.ts';
import type { Observation } from '../../shared/src/schemas.ts';
import type { LiveCreateInput, LiveStore } from './store.ts';

const bounded = (min: number, max: number) => z.number().int().safe().min(min).max(max).refine(value => !Object.is(value, -0));
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const boundary = bounded(-1, 120);
const sequence = bounded(0, 121);
const optionsSchema = z.object({ roundId: uuid, ownerId: uuid, ttlSeconds: bounded(1, 60).default(30) }).strict();
const metadataFields = {
  round_id: uuid, classification: z.literal('exhibition'), policy_ids: z.tuple([z.literal('rules')]),
  status: z.enum(['running', 'completed']), tick: boundary, sequence,
  configuration_hash: HashSchema, schedule_hash: HashSchema,
};
const statusSchema = z.object({ ...metadataFields, schemaVersion: z.literal('live-round-status-1'), ready: z.boolean() }).strict();
const recoverySchema = z.object({
  schemaVersion: z.literal('recovery-1'), workerVersion: z.literal('rules-worker-1'), roundId: uuid,
  contracts: ContractVersionsSchema, configurationHash: HashSchema, votingEnabled: z.literal(false),
  schedule: StoredScheduleSchema, committedTick: boundary, sequence, frame: FrameSchema,
  recentActions: z.array(ActionSummarySchema).max(5), stateHash: HashSchema,
}).strict();
const recordSchema = z.object({ ...metadataFields, schemaVersion: z.literal('live-recovery-1'), recovery: recoverySchema }).strict();
export type RulesRecovery = z.infer<typeof recoverySchema>;
export type RulesWorkerStore = Pick<LiveStore, 'getRoundStatus' | 'acquireLease' | 'getRecovery' | 'renewLease' | 'commitTick' | 'releaseLease'>;
export interface RulesTickResult { status: 'committed' | 'completed' | 'waiting'; tick: number; sequence: number; replayed: boolean }
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
  return stateHash({ ...position, scheduleHash: schedule.hash, scenario: 'clean', configurationHash });
}
function step(position: ReplayPosition, schedule: DemandSchedule, tick: number): ReplayPosition {
  let frame = position.frame;
  if (frame.stage === 'committed') frame = advanceTick(frame);
  if (tick === 120) return { frame: settle(frame), recentActions: position.recentActions };
  const promotion = frame.state.promotion;
  const active = !!promotion && promotion.startsAt <= tick && promotion.endsAt >= tick;
  frame = prepareTick(frame, { arrivals: arrivalsAt(schedule, tick, active).map(toEngineArrival) });
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
function envelope(roundId: string, schedule: DemandSchedule, tick: number, position: ReplayPosition): RulesRecovery {
  return parse(recoverySchema, { schemaVersion: 'recovery-1', workerVersion: 'rules-worker-1', roundId,
    contracts: CONTRACT_VERSIONS, configurationHash, votingEnabled: false, schedule,
    committedTick: tick, sequence: tick + 1, ...position, stateHash: hash(position, schedule) }, 'recovery');
}
/** Creates only a development-seed, clean, one-policy exhibition. Audience and model dispatch are disabled. */
export function createRulesRoundInput(roundId: string, seed: number, published = false): LiveCreateInput {
  const input = parse(z.object({ roundId: uuid, seed: bounded(0, 99), published: z.boolean() }).strict(), { roundId, seed, published }, 'input');
  const schedule = createDemandSchedule(input.seed, 'clean');
  return { roundId: input.roundId, classification: 'exhibition', policyIds: ['rules'], configurationHash,
    scheduleHash: schedule.hash, recovery: envelope(input.roundId, schedule, -1, replay(schedule, -1)), published: input.published };
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
    if (!status.ready) return { status: 'waiting', tick: status.tick, sequence: status.sequence, replayed: false };
    const lease = await store.acquireLease(options);
    ownership = { roundId: options.roundId, ownerId: options.ownerId, fence: lease.fence };
    const record = parse(recordSchema, await store.getRecovery(ownership), 'recovery');
    metadata(record, options.roundId);
    const saved = record.recovery;
    if (record.status !== 'running' || saved.roundId !== options.roundId || saved.configurationHash !== configurationHash ||
      saved.committedTick !== record.tick || saved.sequence !== record.sequence || saved.schedule.hash !== record.schedule_hash ||
      saved.schedule.scenario !== 'clean' || saved.schedule.shock !== null || saved.schedule.seed > 99 || status.schedule_hash !== record.schedule_hash) fail();
    const position = replay(saved.schedule, record.tick);
    if (saved.stateHash !== hash(position, saved.schedule) || canonicalState(saved.frame) !== canonicalState(position.frame) ||
      canonicalState(saved.recentActions) !== canonicalState(position.recentActions)) fail();
    const tick = record.tick + 1;
    const next = step(position, saved.schedule, tick);
    const score = scoreState(next.frame.state);
    const snapshot = { policies: [{ policy_id: 'rules' as const, cash_cents: next.frame.state.cashCents,
      profit_cents: score.profitCents, utility_points: score.utilityPoints,
      served: next.frame.state.totals.served, abandoned: next.frame.state.totals.abandoned }] };
    const decisions = tick === 120 ? [] : [{ policy_id: 'rules' as const, action: next.recentActions.at(-1)!.action,
      source: 'rules' as const, fallback_reason: null }];
    await store.renewLease({ ...ownership, ttlSeconds: options.ttlSeconds });
    const committed = await store.commitTick({ ...ownership, expectedSequence: record.sequence, tick,
      commitKey: rulesCommitKey(options.roundId, tick, saved.schedule.hash), snapshot, decisions,
      recovery: envelope(options.roundId, saved.schedule, tick, next) });
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
