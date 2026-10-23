/** Presentation only. Never award sales, mutate a replay, or infer uncommitted outcomes. */
export interface HawkerObservation {
  action: string | null;
  cooking: boolean;
  queue: number;
  ready: number;
  raw: number;
  settled: boolean;
  profitCents: number;
}
import {
  HAWKER_CLIPS,
  type HawkerClip,
} from "../../../packages/art/src/hawker.ts";
export type { HawkerClip };
export const CLIP_TIMING = HAWKER_CLIPS;
export function selectHawkerClip(state: HawkerObservation): HawkerClip {
  if (state.settled) return state.profitCents > 0 ? "celebrate" : "waiting";
  if (state.action === "SERVE") return "serve";
  if (state.cooking) return "prepare";
  if (state.queue > 0 && state.ready === 0 && state.raw === 0)
    return "shortage";
  if (state.action === "RESTOCK" || state.queue > 0) return "waiting";
  return "idle";
}
/** Elapsed presentation milliseconds from the currently committed tick, reset on every seek. */
export function clipFrame(
  clip: HawkerClip,
  elapsedMs: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 0;
  const timing = CLIP_TIMING[clip];
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const index = Math.floor((elapsed * timing.fps) / 1000);
  return timing.loop
    ? index % timing.frames
    : Math.min(timing.frames - 1, index);
}
