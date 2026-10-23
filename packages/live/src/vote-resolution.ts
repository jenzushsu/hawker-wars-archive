import { createHash } from 'node:crypto';
import { DEMAND_CONFIG } from '../../shared/src/config.ts';
import { keyedDraw, type DemandSchedule, type PotentialArrival } from '../../simulation/src/demand.ts';
import { canonicalArchive, StoredScheduleSchema } from '../../replay/src/schema.ts';
import { ResolutionSchema, ResolveVoteCountsInputSchema, voteLeaders, type VoteResolution } from './vote-resolution-schema.ts';
export { ResolutionSchema, type VoteResolution, type LiveVoteResolution } from './vote-resolution-schema.ts';

/** Independent keyed tie stream: resolving a vote consumes no mutable demand state. */
export function resolveVoteCounts(input: { roundId: string; seed: number; effectiveTick: number; counts: VoteResolution['counts'] }): VoteResolution {
  const value = ResolveVoteCountsInputSchema.parse(input);
  const tied = voteLeaders(value.counts);
  const draw = tied.length > 1 ? keyedDraw(value.seed, 'vote_tie', 0, 0) : null;
  return ResolutionSchema.parse({ schemaVersion: 'live-vote-resolution-1', round_id: value.roundId, window_index: 0,
    counts: value.counts, winner: tied.length === 0 ? null : tied[draw === null ? 0 : Math.floor(draw.r * tied.length / DEMAND_CONFIG.drawDenominator)],
    tied_options: tied, draw_r: draw?.r ?? null, draw_digest: draw?.digestHex ?? null, effective_tick: value.effectiveTick });
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
/** Apply one resolved event to stored clean potentials. Existing arrival randomness is
 * preserved; bus only draws its six additional patience values at the resolved tick.
 * Promotion slot indices move past the bus, but their stored patience is not redrawn.
 */
export function applyVoteResolution(baseSchedule: DemandSchedule, resolution: VoteResolution): DemandSchedule {
  const base = StoredScheduleSchema.parse(baseSchedule);
  const resolved = ResolutionSchema.parse(resolution);
  if (base.scenario !== 'clean' || base.shock !== null) throw new Error('Vote requires a clean stored schedule');
  const expected = resolveVoteCounts({ roundId: resolved.round_id, seed: base.seed, effectiveTick: resolved.effective_tick, counts: resolved.counts });
  if (canonicalArchive(expected) !== canonicalArchive(resolved)) throw new Error('Vote tie evidence does not match stored seed');
  if (resolved.winner === null) return baseSchedule;
  const ticks: PotentialArrival[][] = base.ticks.map(arrivals => arrivals.map(arrival => ({ ...arrival })));
  const privateToPublicIds = { ...base.privateToPublicIds };
  if (resolved.winner === 'bus') {
    const arrivals = ticks[resolved.effective_tick]!;
    const baseArrivals = arrivals.filter(arrival => arrival.source === 'base');
    const bus: PotentialArrival[] = Array.from({ length: DEMAND_CONFIG.busArrivals }, (_, ordinal) => {
      const slotIndex = baseArrivals.length + ordinal;
      const patience = DEMAND_CONFIG.patienceMinimum + keyedDraw(base.seed, 'patience', resolved.effective_tick, slotIndex).r % DEMAND_CONFIG.patienceModulo;
      const publicId = `customer-${resolved.effective_tick}-bus-${ordinal}`;
      const id = `seed-${base.seed}:${publicId}`;
      privateToPublicIds[id] = publicId;
      return { id, publicId, arrivalTick: resolved.effective_tick, patience, deadlineTick: resolved.effective_tick + patience,
        source: 'bus', ordinal, slotIndex, rainKeep: true };
    });
    ticks[resolved.effective_tick] = [...baseArrivals, ...bus,
      ...arrivals.filter(arrival => arrival.source === 'promotion').map(arrival => ({ ...arrival, slotIndex: arrival.slotIndex + bus.length }))];
  }
  const contents = { version: base.version, seed: base.seed, scenario: resolved.winner,
    shock: { id: `vote:${resolved.round_id}:0`, type: resolved.winner, effectiveTick: resolved.effective_tick,
      endsAt: resolved.effective_tick + (resolved.winner === 'bus' ? 0 : 9) }, ticks, privateToPublicIds };
  const hash = createHash('sha256').update('hawker-wars|demand-1|schedule\n').update(canonicalArchive(contents)).digest('hex');
  return freeze(StoredScheduleSchema.parse({ ...contents, hash }));
}
