import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DemoLoadError, parseDemoData } from "../apps/web/lib/load-demo.js";
import type { DemoData } from "../apps/web/lib/demo.js";
const fixture = JSON.parse(
  readFileSync("apps/web/public/demo.json", "utf8"),
) as DemoData;
const copy = () => structuredClone(fixture);
function expectCode(value: unknown, code: "empty" | "invalid") {
  try {
    parseDemoData(value);
    throw new Error("Unexpectedly accepted payload");
  } catch (error) {
    expect(error).toBeInstanceOf(DemoLoadError);
    expect((error as DemoLoadError).code).toBe(code);
  }
}
describe("untrusted offline replay loading", () => {
  it("accepts the complete generated fixture without changing it", () => {
    const value = copy(),
      before = JSON.stringify(value);
    expect(parseDemoData(value)).toBe(value);
    expect(JSON.stringify(value)).toBe(before);
  });
  it("distinguishes a valid empty collection from malformed or mislabeled payloads", () => {
    expectCode({ ...copy(), scenarios: [] }, "empty");
    expectCode(
      { ...copy(), scenarios: [], modelInferencePerformed: true },
      "invalid",
    );
    for (const value of [
      null,
      [],
      {},
      "unavailable",
      { ...copy(), scenarios: null },
    ])
      expectCode(value, "invalid");
  });
  it.each([
    ["schemaVersion", "web-demo-2"],
    ["classification", "live"],
    ["modelInferencePerformed", true],
    ["benchmarkResultsIncluded", true],
    ["currency", "USD"],
    ["scorerVersion", "unknown"],
  ])("rejects misleading provenance: %s", (key, value) => {
    expectCode({ ...copy(), [key]: value }, "invalid");
  });
  it("requires every recorded scenario, tick, stall and terminal boundary", () => {
    const scenarios = copy();
    scenarios.scenarios[1]!.id = "clean";
    expectCode(scenarios, "invalid");
    const missing = copy();
    missing.scenarios[0].turns.pop();
    expectCode(missing, "invalid");
    const stalls = copy();
    stalls.scenarios[0].turns[0]!.stalls.pop();
    expectCode(stalls, "invalid");
    const tick = copy();
    tick.scenarios[0].turns[1]!.tick = 0;
    expectCode(tick, "invalid");
    const terminal = copy();
    Object.assign(terminal.scenarios[0].terminal, { tick: 119 });
    expectCode(terminal, "invalid");
    const missingTerminal = copy();
    Object.assign(missingTerminal.scenarios[0], { terminal: null });
    expectCode(missingTerminal, "invalid");
  });
  it("rejects crash-prone numeric, observation and summary fields", () => {
    for (const bad of [null, "1", Infinity, NaN]) {
      const data = copy();
      Object.assign(data.scenarios[0].turns[0]!.rulesBaseline, {
        utilityPoints: bad,
      });
      expectCode(data, "invalid");
    }
    const observation = copy();
    Object.assign(
      observation.scenarios[0].turns[0]!.stalls[0].observationSummary!,
      { legalActions: null },
    );
    expectCode(observation, "invalid");
    const summary = copy();
    Object.assign(summary.scenarios[0].turns[0]!, { eventSummary: [null] });
    expectCode(summary, "invalid");
    const name = copy();
    Object.assign(name.competitors[0], { name: {} });
    expectCode(name, "invalid");
    const effect = copy();
    Object.assign(effect.scenarios[0].turns[0]!, { effectActivity: {} });
    expectCode(effect, "invalid");
  });
  it("rejects false mirror results and inconsistent event projections", () => {
    const mirror = copy();
    mirror.scenarios[0].turns[0]!.stalls[0].profitCents++;
    expectCode(mirror, "invalid");
    const activity = copy();
    activity.scenarios[0].turns[0]!.customerActivity.received++;
    expectCode(activity, "invalid");
    const queue = copy();
    queue.scenarios[0].turns[0]!.customerActivity.queuePoses.push("walk");
    expectCode(queue, "invalid");
    const final = copy();
    final.scenarios[0].terminal.rulesBaseline.provisional = true;
    expectCode(final, "invalid");
  });
});
