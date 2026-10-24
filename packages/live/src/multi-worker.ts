import { createHash } from 'node:crypto';
import { z } from 'zod';
import { configurationHash } from '../../../scripts/config-snapshot.ts';
import { CONTRACT_VERSIONS } from '../../shared/src/config.ts';
import { ActionSchema, ContractVersionsSchema, DecisionResultSchema, HashSchema, type DecisionInput, type Observation } from '../../shared/src/schemas.ts';
import { chooseRules } from '../../decisions/src/rules.ts';
import { createInitialFrame, prepareTick, applyAction, advanceTick, settle } from '../../simulation/src/engine.ts';
import { createDemandSchedule, arrivalsAt, toEngineArrival, eventAt, type DemandSchedule } from '../../simulation/src/demand.ts';
import { decisionInput } from '../../simulation/src/observation.ts';
import { canonicalState, stateHash } from '../../simulation/src/hash.ts';
import { scoreState } from '../../simulation/src/scoring.ts';
import { FrameSchema, StoredScheduleSchema } from '../../replay/src/schema.ts';
import type { EngineFrame } from '../../simulation/src/types.ts';
import type { LiveProvider } from '../../providers/src/activation.ts';
import type { LiveTurn } from '../../providers/src/adapter.ts';
import type { LiveCreateInput, LiveCommitInput } from './store.ts';
import { RulesWorkerError, type RulesWorkerStore, type RulesTickResult } from './worker.ts';

export const MULTI_POLICIES = ['rules', 'jev', 'zoom', 'zoom-pro'] as const;
type Policy = typeof MULTI_POLICIES[number];
const integer = (min: number, max: number) => z.number().int().safe().min(min).max(max).refine(n => !Object.is(n, -0));
const uuid = z.string().uuid().refine(s => s === s.toLowerCase());
const policy = z.enum(MULTI_POLICIES);
const reason = z.enum(['invalid', 'illegal', 'network', 'rate-limit', 'timeout', 'uncertain', 'budget', 'quota']);
const turnSchema = z.object({ action: ActionSchema, source: z.enum(['rules', 'model', 'forced_wait']), fallbackReason: reason.nullable() }).strict();
type Turn = z.infer<typeof turnSchema>;
const positionSchema = z.object({ policy, frame: FrameSchema, actions: z.array(turnSchema).max(120), stateHash: HashSchema }).strict();
const recoverySchema = z.object({
  schemaVersion: z.literal('recovery-1'), workerVersion: z.literal('multi-policy-worker-1'), roundId: uuid,
  contracts: ContractVersionsSchema, configurationHash: HashSchema, providerConfigurationHash: HashSchema,
  votingEnabled: z.literal(false), schedule: StoredScheduleSchema, committedTick: integer(-1, 120), sequence: integer(0, 121),
  policies: z.array(positionSchema).length(4),
}).strict();
const metadataFields = {
  round_id: uuid, classification: z.literal('exhibition'), policy_ids: z.tuple([z.literal('rules'), z.literal('jev'), z.literal('zoom'), z.literal('zoom-pro')]),
  status: z.enum(['running', 'completed']), tick: integer(-1, 120), sequence: integer(0, 121),
  control_state: z.enum(['active', 'paused', 'stopped']), control_revision: integer(0, Number.MAX_SAFE_INTEGER),
  configuration_hash: HashSchema, schedule_hash: HashSchema,
};
const statusSchema = z.object({ ...metadataFields, schemaVersion: z.literal('live-round-status-1'), ready: z.boolean() }).strict();
const recordSchema = z.object({ ...metadataFields, schemaVersion: z.literal('live-recovery-1'), recovery: recoverySchema }).strict();
export type MultiRecovery = z.infer<typeof recoverySchema>;
export type MultiControllers = Record<LiveProvider, { decideTurn(input: DecisionInput): Promise<LiveTurn> }>;
interface Position { frame: EngineFrame; actions: Turn[] }
const fail = (): never => { throw new RulesWorkerError('recovery'); };
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, code: 'input' | 'recovery'): z.output<S> {
  try { return schema.parse(value); } catch { throw new RulesWorkerError(code); }
}
function recent(position: Position): Observation['recentActions'] {
  return position.actions.slice(-5).map((turn, index) => ({ tick: position.actions.length - Math.min(5, position.actions.length) + index, action: turn.action }));
}
function hash(position: Position, schedule: DemandSchedule): string {
  return stateHash({ frame: position.frame, recentActions: recent(position), scheduleHash: schedule.hash, scenario: schedule.scenario, configurationHash });
}
function prepare(position: Position, schedule: DemandSchedule, tick: number): EngineFrame {
  let frame = position.frame.stage === 'committed' ? advanceTick(position.frame) : position.frame;
  if (tick === 120) return settle(frame);
  const promotion = frame.state.promotion;
  const arrivals = arrivalsAt(schedule, tick, !!promotion && promotion.startsAt <= tick && promotion.endsAt >= tick).map(toEngineArrival);
  const event = eventAt(schedule, tick);
  return prepareTick(frame, event ? { arrivals, event } : { arrivals });
}
function validateTurn(turn: Turn, id: Policy, input: DecisionInput): void {
  if (!input.legalActions.includes(turn.action)) fail();
  const rules = chooseRules(input.observation, input.legalActions).action;
  if (id === 'rules') {
    if (turn.source !== 'rules' || turn.fallbackReason !== null || turn.action !== rules) fail();
  } else if (input.legalActions.length === 1) {
    if (turn.source !== 'forced_wait' || turn.action !== 'WAIT' || turn.fallbackReason !== null) fail();
  } else if (turn.source === 'rules') {
    if (turn.fallbackReason === null || turn.action !== rules) fail();
  } else if (turn.source !== 'model' || turn.fallbackReason !== null) fail();
}
/** Reconstruct only from committed choices. Recovery never re-queries a model. */
function replay(id: Policy, actions: Turn[], schedule: DemandSchedule, tick: number, roundId: string): Position {
  if (actions.length !== Math.min(tick + 1, 120)) fail();
  let position: Position = { frame: createInitialFrame(), actions: [] };
  for (let index = 0; index <= tick; index++) {
    const frame = prepare(position, schedule, index);
    if (index === 120) { position = { ...position, frame }; break; }
    const turn = actions[index]!;
    validateTurn(turn, id, decisionInput(frame.state, roundId, recent(position)));
    position = { frame: applyAction(frame, turn.action), actions: [...position.actions, turn] };
  }
  return position;
}
function envelope(roundId: string, schedule: DemandSchedule, providerConfigurationHash: string, tick: number, positions: Position[]): MultiRecovery {
  return parse(recoverySchema, { schemaVersion: 'recovery-1', workerVersion: 'multi-policy-worker-1', roundId,
    contracts: CONTRACT_VERSIONS, configurationHash, providerConfigurationHash, votingEnabled: false,
    schedule, committedTick: tick, sequence: tick + 1,
    policies: MULTI_POLICIES.map((id, index) => ({ policy: id, ...positions[index]!, stateHash: hash(positions[index]!, schedule) })),
  }, 'recovery');
}
/** Clean comparison only. Multi-policy voting is deliberately not enabled by this protocol. */
export function createMultiRoundInput(roundId: string, seed: number, providerConfigurationHash: string, published = false): LiveCreateInput {
  parse(z.object({ roundId: uuid, seed: integer(0, 99), providerConfigurationHash: HashSchema, published: z.boolean() }).strict(),
    { roundId, seed, providerConfigurationHash, published }, 'input');
  const schedule = createDemandSchedule(seed, 'clean');
  const positions = MULTI_POLICIES.map(id => replay(id, [], schedule, -1, roundId));
  return { roundId, classification: 'exhibition', policyIds: [...MULTI_POLICIES], configurationHash, scheduleHash: schedule.hash,
    recovery: envelope(roundId, schedule, providerConfigurationHash, -1, positions), published };
}
export function multiCommitKey(roundId: string, tick: number, providerConfigurationHash: string): string {
  parse(z.object({ roundId: uuid, tick: integer(0, 120), providerConfigurationHash: HashSchema }), { roundId, tick, providerConfigurationHash }, 'input');
  const chars = createHash('sha256').update(`hawker-wars|multi-policy-worker-1|${roundId}|${configurationHash}|${providerConfigurationHash}|${tick}`).digest('hex').slice(0, 32).split('');
  chars[12] = '8'; chars[16] = '8'; const h = chars.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function fallback(input: DecisionInput, fallbackReason: NonNullable<Turn['fallbackReason']>): Turn {
  return { action: chooseRules(input.observation, input.legalActions).action, source: 'rules', fallbackReason };
}
async function choose(id: Policy, input: DecisionInput, controllers: MultiControllers): Promise<Turn> {
  if (id === 'rules') return { action: chooseRules(input.observation, input.legalActions).action, source: 'rules', fallbackReason: null };
  if (input.legalActions.length === 1) return { action: 'WAIT', source: 'forced_wait', fallbackReason: null };
  // Controllers are the existing durable provider adapters, each enforcing its own
  // four-second abort deadline and never retrying an uncertain dispatch.
  let turn: LiveTurn;
  try { turn = await controllers[id].decideTurn(structuredClone(input)); }
  catch { return fallback(input, 'network'); }
  const parsed = DecisionResultSchema.safeParse(turn?.result);
  if (!parsed.success || parsed.data.provider !== id || turn?.mode !== 'live') return fallback(input, 'invalid');
  const result = parsed.data;
  if (result.status === 'fallback') return fallback(input, result.fallbackReason!);
  if (result.status !== 'success' || result.action === null) return fallback(input, 'invalid');
  if (!input.legalActions.includes(result.action)) return fallback(input, 'illegal');
  return { action: result.action, source: 'model', fallbackReason: null };
}
function metadata(value: z.infer<typeof statusSchema> | z.infer<typeof recordSchema>, roundId: string): void {
  if (value.round_id !== roundId || value.configuration_hash !== configurationHash || value.sequence !== value.tick + 1 || (value.status === 'completed') !== (value.tick === 120)) fail();
}
/** One fenced, atomic four-policy boundary. No simulation state survives failed commits. */
export async function runMultiTick(store: RulesWorkerStore, input: { roundId: string; ownerId: string; providerConfigurationHash: string }, controllers: MultiControllers): Promise<RulesTickResult> {
  const options = parse(z.object({ roundId: uuid, ownerId: uuid, providerConfigurationHash: HashSchema }).strict(), input, 'input');
  let ownership: { roundId: string; ownerId: string; fence: number } | null = null;
  try {
    const status = parse(statusSchema, await store.getRoundStatus(options.roundId), 'recovery');
    metadata(status, options.roundId);
    if (status.status === 'completed') return { status: 'completed', tick: 120, sequence: 121, replayed: false };
    if (status.control_state !== 'active') return { status: status.control_state, tick: status.tick, sequence: status.sequence, replayed: false };
    if (!status.ready) return { status: 'waiting', tick: status.tick, sequence: status.sequence, replayed: false };
    const lease = await store.acquireLease({ roundId: options.roundId, ownerId: options.ownerId, ttlSeconds: 30 });
    ownership = { roundId: options.roundId, ownerId: options.ownerId, fence: lease.fence };
    const record = parse(recordSchema, await store.getRecovery(ownership), 'recovery');
    metadata(record, options.roundId);
    const saved = record.recovery;
    if (record.status !== 'running' || record.control_state !== 'active' || saved.roundId !== options.roundId || saved.configurationHash !== configurationHash ||
      saved.providerConfigurationHash !== options.providerConfigurationHash || saved.committedTick !== record.tick || saved.sequence !== record.sequence ||
      saved.schedule.hash !== record.schedule_hash || status.schedule_hash !== record.schedule_hash || saved.schedule.scenario !== 'clean' || saved.schedule.shock !== null || saved.schedule.seed > 99 ||
      canonicalState(saved.contracts) !== canonicalState(CONTRACT_VERSIONS) || canonicalState(saved.policies.map(p => p.policy)) !== canonicalState(MULTI_POLICIES)) fail();
    // StoredScheduleSchema validates shape; a clean schedule is also reproduced
    // from its development seed to reject coordinated schedule/hash corruption.
    if (canonicalState(saved.schedule) !== canonicalState(createDemandSchedule(saved.schedule.seed, 'clean'))) fail();
    const positions = saved.policies.map(p => {
      const position = replay(p.policy, p.actions, saved.schedule, record.tick, options.roundId);
      if (p.stateHash !== hash(position, saved.schedule) || canonicalState(p.frame) !== canonicalState(position.frame)) fail();
      return position;
    });
    const tick = record.tick + 1;
    const prepared = positions.map(position => prepare(position, saved.schedule, tick));
    // Renew immediately before any dispatch and again before commit. Operator
    // transitions invalidate the fence; the DB rejects the entire mixed tick.
    await store.renewLease({ ...ownership, ttlSeconds: 30 });
    const turns = tick === 120 ? [] : await Promise.all(MULTI_POLICIES.map((id, index) =>
      choose(id, decisionInput(prepared[index]!.state, options.roundId, recent(positions[index]!)), controllers)));
    const next = prepared.map((frame, index): Position => tick === 120 ? { frame, actions: positions[index]!.actions } :
      { frame: applyAction(frame, turns[index]!.action), actions: [...positions[index]!.actions, turns[index]!] });
    const policies = next.map((position, index) => {
      const state = position.frame.state, score = scoreState(state), previous = positions[index]!.frame.state;
      return { policy_id: MULTI_POLICIES[index]!, cash_cents: state.cashCents, profit_cents: score.profitCents, utility_points: score.utilityPoints,
        served: state.totals.served, abandoned: state.totals.abandoned, activity: {
          queue: state.queue.length, queuePoses: state.queue.slice(0, 3).map(c => c.arrivalTick === tick ? 'walk' as const : c.deadlineTick - tick <= 1 ? 'impatient' as const : 'wait' as const),
          received: state.totals.served - previous.totals.served, departed: state.totals.abandoned - previous.totals.abandoned,
          cooking: state.cooking !== null, ready: state.readyBatches.reduce((n, b) => n + b.quantity, 0), raw: state.rawPortions,
          action: tick === 120 ? null : turns[index]!.action,
        } };
    });
    const decisions: LiveCommitInput['decisions'] = turns.map((turn, index) => ({ policy_id: MULTI_POLICIES[index]!, action: turn.action, source: turn.source, fallback_reason: turn.fallbackReason }));
    await store.renewLease({ ...ownership, ttlSeconds: 30 });
    const result = await store.commitTick({ ...ownership, expectedSequence: record.sequence, tick,
      commitKey: multiCommitKey(options.roundId, tick, options.providerConfigurationHash), snapshot: { policies }, decisions,
      recovery: envelope(options.roundId, saved.schedule, options.providerConfigurationHash, tick, next) });
    if (result.round_id !== options.roundId || result.tick !== tick || result.sequence !== tick + 1 || typeof result.replayed !== 'boolean') fail();
    return { status: tick === 120 ? 'completed' : 'committed', tick, sequence: result.sequence, replayed: result.replayed };
  } catch (error) {
    if (error instanceof RulesWorkerError) throw error;
    throw new RulesWorkerError('store');
  } finally { if (ownership) { try { await store.releaseLease(ownership); } catch { /* expiry fences uncertain releases */ } } }
}
