import { LiveActivitySchema } from './activity.ts';
import { z } from 'zod';

// Browser-safe public protocol only. Never import the privileged store or simulator here.
const integer = z.number().int().safe().refine(value => !Object.is(value, -0));
const bounded = (min: number, max: number) => integer.refine(value => value >= min && value <= max);
const positive = bounded(0, Number.MAX_SAFE_INTEGER);
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const option = z.enum(['bus', 'rain', 'supplier-delay']);
const counts = z.object({ bus: bounded(0, 400), rain: bounded(0, 400), 'supplier-delay': bounded(0, 400) }).strict()
  .refine(value => Object.values(value).reduce((sum, count) => sum + count, 0) <= 400);
const metrics = z.object({ policies: z.array(z.object({
  policy_id: z.enum(['rules', 'jev', 'zoom', 'zoom-pro']), cash_cents: positive,
  profit_cents: integer, utility_points: integer, served: positive, abandoned: positive, activity: LiveActivitySchema.optional(),
}).strict()).min(1).max(4).refine(values => new Set(values.map(value => value.policy_id)).size === values.length) }).strict();
const snapshot = z.object({ schemaVersion: z.literal('live-snapshot-1'), round_id: uuid,
  classification: z.enum(['offline-contract', 'clean', 'stress', 'exhibition', 'replay']),
  tick: bounded(-1, 120), sequence: bounded(0, 121), status: z.enum(['running', 'completed']),
  configuration_hash: z.string().regex(/^[a-f0-9]{64}$/), control_state: z.enum(['active', 'paused', 'stopped']), control_revision: positive,
  snapshot: z.union([metrics, z.object({ policies: z.tuple([]) }).strict()]),
}).strict().refine(value => value.sequence === value.tick + 1 && (value.status === 'completed') === (value.tick === 120) &&
  (value.snapshot.policies.length === 0) === (value.tick === -1));
const event = z.object({ round_id: uuid, sequence: bounded(1, 121), tick: bounded(0, 120),
  event_type: z.enum(['tick-committed', 'round-closed']), snapshot: metrics,
}).strict().refine(value => value.sequence === value.tick + 1 && (value.event_type === 'round-closed') === (value.tick === 120));
export const PublicVoteWindowSchema = z.object({ schemaVersion: z.literal('live-vote-window-1'), round_id: uuid,
  window_index: z.literal(0), status: z.enum(['open', 'locked', 'disabled']), paused: z.boolean(),
  deadline_ms: positive.nullable(), remaining_ms: bounded(0, 20_000), counts,
  eligible_options: z.array(option).max(3),
}).strict().refine(value => {
  const accepting = value.status === 'open' && !value.paused;
  return (accepting ? value.eligible_options.length === 3 && new Set(value.eligible_options).size === 3 : value.eligible_options.length === 0) &&
    (value.status === 'open' ? value.remaining_ms > 0 && (value.paused ? value.deadline_ms === null : value.deadline_ms !== null)
      : value.deadline_ms === null && value.remaining_ms === 0);
});
export const PublicVoteResultSchema = z.object({ schemaVersion: z.literal('live-vote-result-1'), round_id: uuid,
  winner: option.nullable(), effective_tick: bounded(31, 119), ends_at: positive.nullable(), counts, applied: z.boolean(),
}).strict().refine(value => {
  const maximum = Math.max(...Object.values(value.counts));
  return value.winner === null ? maximum === 0 && value.ends_at === null :
    maximum > 0 && value.counts[value.winner] === maximum && value.ends_at === value.effective_tick + (value.winner === 'bus' ? 0 : 9);
});
export const PublicVoteReceiptSchema = z.object({ schemaVersion: z.literal('live-vote-receipt-1'), round_id: uuid,
  window_index: z.literal(0), request_id: uuid, option_id: option, accepted_at_ms: positive, replayed: z.boolean(),
}).strict();
export const PublicViewSchema = z.object({ schemaVersion: z.literal('live-view-1'), snapshot,
  events: z.object({ high_water: bounded(0, 121), events: z.array(event).max(100) }).strict(),
  vote_window: PublicVoteWindowSchema.nullable(), vote_result: PublicVoteResultSchema.nullable(), server_time_ms: positive,
}).strict().superRefine((value, context) => {
  const invalid = () => context.addIssue({ code: 'custom', message: 'Inconsistent public view' });
  const id = value.snapshot.round_id;
  if (value.events.high_water !== value.snapshot.sequence) invalid();
  if (value.events.events.some((item, index, list) => item.round_id !== id || item.sequence > value.events.high_water ||
    (index > 0 && item.sequence !== list[index - 1]!.sequence + 1))) invalid();
  const latest = value.events.events.at(-1);
  if (latest?.sequence === value.snapshot.sequence && JSON.stringify(latest.snapshot) !== JSON.stringify(value.snapshot.snapshot)) invalid();
  if (value.vote_window !== null && (value.vote_window.round_id !== id || value.snapshot.tick < 30 || value.snapshot.classification !== 'exhibition')) invalid();
  if (value.vote_result !== null) {
    const result = value.vote_result;
    if (result.round_id !== id || value.vote_window === null || value.vote_window.status === 'open' ||
      (result.applied ? result.effective_tick > value.snapshot.tick : result.effective_tick !== value.snapshot.tick + 1) ||
      JSON.stringify(result.counts) !== JSON.stringify(value.vote_window.counts)) invalid();
  }
});
export type PublicView = z.infer<typeof PublicViewSchema>;
export type PublicViewEvent = PublicView['events']['events'][number];
export type PublicVoteReceipt = z.infer<typeof PublicVoteReceiptSchema>;
export class PublicViewError extends Error { constructor() { super('Invalid public view'); this.name = 'PublicViewError'; } }
export function parsePublicView(value: unknown, request: { roundId: string; afterSequence: number; limit?: number }): PublicView {
  try {
    const input = z.object({ roundId: uuid, afterSequence: bounded(0, 121), limit: bounded(1, 100).default(100) }).strict().parse(request);
    const parsed = PublicViewSchema.parse(value);
    if (parsed.snapshot.round_id !== input.roundId || parsed.events.high_water < input.afterSequence ||
      parsed.events.events.length !== Math.min(input.limit, parsed.events.high_water - input.afterSequence) ||
      parsed.events.events.some((item, index) => item.sequence !== input.afterSequence + index + 1)) throw new Error();
    return parsed;
  } catch { throw new PublicViewError(); }
}
