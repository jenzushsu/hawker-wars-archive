import {
  customerFrameAt,
  type CustomerClip,
  type CustomerDirection,
} from "../../../packages/art/src/customer.ts";
import type { DemoCustomerActivity } from "./demo.js";
export interface CustomerPose {
  role: "queue" | "receive" | "depart" | "eat";
  slot: number;
  clip: CustomerClip;
  direction: CustomerDirection;
  frame: number;
  offsetX: number;
  offsetY: number;
}
/** Bounded representative art, never a second simulation or an authoritative individual tracker. */
export function projectCustomers(
  activity: DemoCustomerActivity,
  servedTotal: number,
  elapsedMs: number,
  reducedMotion: boolean,
): CustomerPose[] {
  const time = reducedMotion
    ? 0
    : Number.isFinite(elapsedMs)
      ? Math.max(0, elapsedMs)
      : 0;
  const pose = (
    role: CustomerPose["role"],
    slot: number,
    clip: CustomerClip,
    direction: CustomerDirection,
    offsetX = 0,
    offsetY = 0,
  ): CustomerPose => ({
    role,
    slot,
    clip,
    direction,
    frame: customerFrameAt(clip, time),
    offsetX,
    offsetY,
  });
  const result = activity.queuePoses
    .slice(0, 3)
    .map((clip, index) =>
      pose(
        "queue",
        index,
        clip === "walk" && time >= 650 ? "wait" : clip,
        "up",
        0,
        clip === "walk" && !reducedMotion
          ? Math.round(36 * (1 - Math.min(time / 650, 1)))
          : 0,
      ),
    );
  if (activity.received > 0) result.push(pose("receive", 0, "receive", "left"));
  if (activity.departed > 0)
    result.push(
      pose(
        "depart",
        0,
        reducedMotion ? "depart" : time < 750 ? "walk" : "wait",
        "right",
        reducedMotion ? 0 : Math.round(Math.min(time / 750, 1) * 36),
      ),
    );
  if (servedTotal > 0) result.push(pose("eat", 0, "eat", "down"));
  return result;
}
