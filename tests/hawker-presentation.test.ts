import { describe, expect, it } from "vitest";
import {
  selectHawkerClip,
  clipFrame,
  type HawkerObservation,
} from "../apps/web/lib/animation.js";
const base: HawkerObservation = {
  action: "WAIT",
  cooking: false,
  queue: 0,
  ready: 0,
  raw: 0,
  settled: false,
  profitCents: 500,
};
describe("committed hawker presentation", () => {
  it("never celebrates provisional profit and gives committed service precedence", () => {
    expect(selectHawkerClip(base)).toBe("idle");
    expect(selectHawkerClip({ ...base, settled: true })).toBe("celebrate");
    expect(selectHawkerClip({ ...base, settled: true, profitCents: -1 })).toBe(
      "waiting",
    );
    expect(selectHawkerClip({ ...base, action: "SERVE", cooking: true })).toBe(
      "serve",
    );
  });
  it("distinguishes shortages from stock in progress and ordinary waits", () => {
    expect(selectHawkerClip({ ...base, queue: 3 })).toBe("shortage");
    expect(selectHawkerClip({ ...base, queue: 3, cooking: true })).toBe(
      "prepare",
    );
    expect(selectHawkerClip({ ...base, queue: 3, raw: 20 })).toBe("waiting");
  });
  it("holds one-shots, loops preparation at cadence, and makes seeking independent of prior frames", () => {
    expect(clipFrame("serve", 499, false)).toBe(4);
    expect(clipFrame("serve", 6000, false)).toBe(5);
    expect(clipFrame("prepare", 750, false)).toBe(0);
    expect(clipFrame("prepare", 749, false)).toBe(5);
    expect(clipFrame("serve", 0, false)).toBe(0);
    expect(clipFrame("celebrate", 9000, true)).toBe(0);
    expect(clipFrame("idle", NaN, false)).toBe(0);
    expect(clipFrame("waiting", -10, false)).toBe(0);
  });
});
