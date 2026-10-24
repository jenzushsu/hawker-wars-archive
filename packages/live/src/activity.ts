import { z } from 'zod';

/** Public presentation evidence only; no customer identities or recovery state. */
export const LiveActivitySchema = z.object({
  queue: z.number().int().min(0).max(30),
  queuePoses: z.array(z.enum(['walk', 'wait', 'impatient'])).max(3),
  received: z.number().int().min(0).max(30),
  departed: z.number().int().min(0).max(30),
  cooking: z.boolean(),
  ready: z.number().int().min(0).max(30),
  raw: z.number().int().min(0).max(60),
  action: z.enum(['SERVE', 'COOK', 'RESTOCK', 'PROMOTE', 'WAIT']).nullable(),
}).strict().refine(value => value.queuePoses.length === Math.min(3, value.queue));
export type LiveActivity = z.infer<typeof LiveActivitySchema>;
