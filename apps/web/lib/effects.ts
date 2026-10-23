import {
  effectFrameAt,
  type EffectClip,
} from "../../../packages/art/src/effects.ts";
import type { DemoEffect } from "./demo.js";
export interface EffectObservation {
  cooking: boolean;
  received: number;
  queue: number;
  ready: number;
  raw: number;
  settled: boolean;
  delivered: boolean;
  effects: DemoEffect[];
}
/** Illustrate committed outcomes only; seeking creates no queued effects or simulation changes. */
export function projectEffects(
  state: EffectObservation,
  elapsedMs: number,
  reducedMotion: boolean,
): { clip: EffectClip; frame: number }[] {
  if (state.settled) return [];
  const time = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const clips: EffectClip[] = [];
  if (state.cooking && !reducedMotion) clips.push("steam");
  if (state.received > 0) clips.push("service");
  if (state.queue > 0 && state.ready === 0 && state.raw === 0)
    clips.push("shortage");
  if (state.delivered) clips.push("delivery");
  for (const effect of ["bus", "rain", "supplier-delay"] as const)
    if (state.effects.includes(effect)) clips.push(effect);
  return clips.map((clip) => ({
    clip,
    frame: reducedMotion ? 0 : effectFrameAt(clip, time),
  }));
}
