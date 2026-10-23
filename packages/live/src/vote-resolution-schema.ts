// Wire validation only: keep simulator and replay dependencies out of server API bundles.
import { z } from 'zod';
import { CHAOS_EVENTS, DEMAND_CONFIG } from '../../shared/src/config.ts';

const integer = (maximum: number) => z.number().int().safe().min(0).max(maximum).refine(value => !Object.is(value, -0));
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const option = z.enum(CHAOS_EVENTS);
const countsSchema = z.object({ bus: integer(400), rain: integer(400), 'supplier-delay': integer(400) }).strict()
  .refine(value => Object.values(value).reduce((sum, count) => sum + count, 0) <= 400);
const tick = z.number().int().min(31).max(119);
export function voteLeaders(counts: z.infer<typeof countsSchema>) {
  const maximum = Math.max(...Object.values(counts));
  return maximum === 0 ? [] : CHAOS_EVENTS.filter(id => counts[id] === maximum).sort();
}
export const ResolutionSchema = z.object({
  schemaVersion: z.literal('live-vote-resolution-1'), round_id: uuid, window_index: z.literal(0),
  counts: countsSchema, winner: option.nullable(), tied_options: z.array(option).max(3),
  draw_r: integer(0xffff_ffff).nullable(), draw_digest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), effective_tick: tick,
}).strict().superRefine((value, ctx) => {
  const tied = voteLeaders(value.counts);
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'Inconsistent vote resolution' });
  if (JSON.stringify(value.tied_options) !== JSON.stringify(tied)) invalid();
  if (tied.length < 2) {
    if (value.draw_r !== null || value.draw_digest !== null || value.winner !== (tied[0] ?? null)) invalid();
  } else {
    if (value.draw_r === null || value.draw_digest === null ||
        Number.parseInt(value.draw_digest.slice(0, 8), 16) !== value.draw_r ||
        value.winner !== tied[Math.floor(value.draw_r * tied.length / DEMAND_CONFIG.drawDenominator)]) invalid();
  }
});
export type VoteResolution = z.infer<typeof ResolutionSchema>;
export type LiveVoteResolution = VoteResolution;

export const ResolveVoteCountsInputSchema = z.object({ roundId: uuid, seed: integer(Number.MAX_SAFE_INTEGER), effectiveTick: tick, counts: countsSchema }).strict();
