import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertPublicDemo } from '../scripts/generate-web-demo.js';
import { getScenario, getTurn, formatGameMoney, type DemoData } from '../apps/web/lib/demo.js';
import { runEpisode } from '../scripts/offline-episode.js';
const data = JSON.parse(readFileSync(new URL('../apps/web/public/demo.json', import.meta.url), 'utf8')) as DemoData;

describe('public offline rules demo', () => {
  it('has four complete scenarios, exactly three disclosed mirrors and a separate baseline', () => {
    expect(() => assertPublicDemo(data)).not.toThrow();
    expect(data.disclosure).toContain('mirror'); expect(data.disclosure).toContain('No live model inference');
    expect(data.scenarios.reduce((count, scenario) => count + scenario.turns.length, 0)).toBe(480);
  });
  it('recomputes every public profit/utility value from the actual local action ledger', () => {
    for (const scenario of data.scenarios) {
      let cash = 20000, served = 0;
      for (const turn of scenario.turns) {
        const baseline = turn.rulesBaseline;
        const servedNow = baseline.served - served; served = baseline.served;
        cash += servedNow * 500;
        if (baseline.action === 'RESTOCK') cash -= 4000;
        if (baseline.action === 'PROMOTE') cash -= 500;
        expect(baseline.profitCents).toBe(cash + 200 * (baseline.rawPortions + baseline.readyPortions + baseline.cookingPortions + baseline.pendingRestockPortions) - 28400);
        expect(baseline.utilityPoints).toBe(baseline.profitCents - 100 * baseline.abandoned - 5 * baseline.waitMinutes - 50 * baseline.wasted);
      }
      const final = scenario.terminal.rulesBaseline;
      expect(final.profitCents).toBe(cash + 200 * final.rawPortions - 28400);
      expect(final.utilityPoints).toBe(final.profitCents - 100 * final.abandoned - 5 * final.waitMinutes - 50 * final.wasted);
      expect(final.validation).toBe('settled');
    }
  });
  it('matches independently rerun clean engine results without model calls', () => {
    const episode = runEpisode({ seed: 0, scenario: 'clean', policy: 'rules' });
    const scenario = getScenario(data, 'clean');
    expect(scenario.turns.map(turn => turn.rulesBaseline.action)).toEqual(episode.trace.map(turn => turn.decision.appliedAction));
    expect(scenario.terminal.rulesBaseline.profitCents).toBe(episode.score.profitCents);
    expect(scenario.terminal.rulesBaseline.utilityPoints).toBe(episode.score.utilityPoints);
    expect(scenario.terminal.rulesBaseline.served).toBe(episode.metrics.served);
    expect(episode.networkCalls).toBe(0);
  });
  it('distinguishes the executed shock boundary from clean and never invents votes or rankings', () => {
    expect(getScenario(data, 'clean').turns.flatMap(turn => turn.eventSummary).some(line => /began|bus arrival/i.test(line))).toBe(false);
    for (const id of ['bus', 'rain', 'supplier-delay'] as const) expect(getScenario(data, id).turns[60]!.eventSummary.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(data);
    for (const privateField of ['"seed"', 'seed-', '"schedule"', '"privateToPublicIds"', '"roundId"', '"requestId"', '"rank"', '"latencyMs"', '"modelVersion"', '"probabilities"']) expect(serialized).not.toContain(privateField);
  });
  it('supports bounded browser seeking and keeps final settlement separate', () => {
    const scenario = getScenario(data);
    expect(getTurn(scenario, -50).tick).toBe(0);
    expect(getTurn(scenario, 999).tick).toBe(119);
    expect(getTurn(scenario, 4.9).tick).toBe(4);
    expect(() => getTurn(scenario, NaN)).toThrow();
    expect(scenario.terminal.tick).toBe(120);
    expect(scenario.terminal.rulesBaseline.provisional).toBe(false);
    expect(formatGameMoney(1234)).toContain('12.34');
  });
});
