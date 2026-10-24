import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { projectCustomers } from "../apps/web/lib/customers.js";
import { runEpisode } from "../scripts/offline-episode.js";
import type { DemoData } from "../apps/web/lib/demo.js";
const data = JSON.parse(
  readFileSync("apps/web/public/demo.json", "utf8"),
) as DemoData;
describe("committed customer art projection", () => {
  it("reconciles all sampled queue poses and service/departure counts with independent rules episodes", () => {
    expect(data.schemaVersion).toBe("web-demo-3");
    for (const scenario of data.scenarios) {
      const run = runEpisode({
        seed: 0,
        scenario: scenario.id,
        policy: "rules",
      });
      let served = 0,
        abandoned = 0;
      for (const [i, turn] of scenario.turns.entries()) {
        const trace = run.trace[i]!;
        const servedNow = turn.rulesBaseline.served - served;
        const queue = trace.observation.queue.slice(servedNow);
        expect(turn.customerActivity.queuePoses).toEqual(
          queue
            .slice(0, 3)
            .map((c) =>
              c.arrivalTick === i
                ? "walk"
                : c.deadlineTick - i <= 1
                  ? "impatient"
                  : "wait",
            ),
        );
        expect(turn.customerActivity.received).toBe(servedNow);
        expect(turn.customerActivity.departed).toBe(
          turn.rulesBaseline.abandoned - abandoned,
        );
        expect(turn.customerActivity.queuePoses.length).toBe(
          Math.min(3, turn.rulesBaseline.queueCount),
        );
        served = turn.rulesBaseline.served;
        abandoned = turn.rulesBaseline.abandoned;
      }
      expect(scenario.terminal.customerActivity.departed).toBe(
        run.metrics.abandoned - abandoned,
      );
    }
  });
  it("does not invent a service, departure or meal before committed evidence", () => {
    expect(
      projectCustomers(
        { queuePoses: ["wait"], received: 0, departed: 0 },
        0,
        0,
        false,
      ).map((p) => p.role),
    ).toEqual(["queue"]);
    const poses = projectCustomers(
      { queuePoses: ["impatient"], received: 3, departed: 2 },
      3,
      350,
      false,
    );
    expect(poses.map((p) => p.role)).toEqual([
      "queue",
      "receive",
      "depart",
      "eat",
    ]);
    expect(poses.find((p) => p.role === "receive")?.frame).toBe(2);
    expect(poses.find((p) => p.role === "depart")?.offsetX).toBe(17);
  });
  it("walks visibly into the queue and settles before the next 800ms tick", () => {
    const activity = { queuePoses: ["walk"] as "walk"[], received: 0, departed: 1 };
    const start = projectCustomers(activity, 0, 0, false);
    const middle = projectCustomers(activity, 0, 325, false);
    const end = projectCustomers(activity, 0, 750, false);
    expect(start[0]?.offsetY).toBe(36);
    expect(middle[0]?.offsetY).toBe(18);
    expect(middle[0]?.clip).toBe("walk");
    expect(end[0]?.offsetY).toBe(0);
    expect(end[0]?.clip).toBe("wait");
    expect(middle[1]?.clip).toBe("walk");
    expect(end[1]?.offsetX).toBe(36);
    expect(end[1]?.clip).toBe("wait");
  });
  it("reconstructs bounded poses on seek and suppresses decorative movement with reduced motion", () => {
    const activity = {
      queuePoses: ["walk"] as "walk"[],
      received: 1,
      departed: 1,
    };
    const first = projectCustomers(activity, 1, 0, false);
    projectCustomers(activity, 1, 99999, false);
    expect(projectCustomers(activity, 1, 0, false)).toEqual(first);
    expect(
      projectCustomers(activity, 1, 9000, true).every(
        (p) => p.frame === 0 && p.offsetX === 0 && p.offsetY === 0,
      ),
    ).toBe(true);
    expect(projectCustomers(activity, 1, NaN, false)).toEqual(first);
  });
});
