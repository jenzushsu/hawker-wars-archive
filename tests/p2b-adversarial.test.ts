import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEpisode } from '../packages/replay/src/record.js';
import { replayArchive } from '../packages/replay/src/replay.js';
import { parseArchive, StoredScheduleSchema, canonicalArchive, type EpisodeArchive } from '../packages/replay/src/schema.js';
import { publicSnapshot, readEpisodeArchive, writeEpisodeArchive } from '../packages/replay/src/store.js';
import * as demand from '../packages/simulation/src/demand.js';
import * as rules from '../packages/decisions/src/rules.js';
import * as decisions from '../packages/decisions/src/fallback.js';
import { advanceTick, applyAction, createInitialFrame, prepareTick } from '../packages/simulation/src/engine.js';
import { configurationHash } from '../scripts/config-snapshot.js';
import {
  enumerateFutureArrivals, maximizingActions, OracleLimitError, OracleTaskSchema,
  OFF_PEAK_BASE_COUNT_PROBABILITIES, solveStaticTask,
} from '../packages/benchmark/src/oracle.js';
import { add, compare, multiply, rational, serializeRational } from '../packages/benchmark/src/rational.js';

let archive: EpisodeArchive;
beforeAll(() => { archive = recordEpisode({ seed: 3, scenario: 'rain', policy: 'mixed', snapshotEvery: 30 }); });
const copy = () => structuredClone(archive);

function rehashStoredSchedule(schedule: demand.DemandSchedule) {
  const { hash: _hash, ...contents } = schedule;
  return { ...contents, hash: createHash('sha256').update('hawker-wars|demand-1|schedule\n').update(canonicalArchive(contents)).digest('hex') };
}

function oneStepTask() {
  let frame = createInitialFrame();
  for (let tick = 0; tick < 119; tick++) {
    const arrivals = tick === 0 ? [{ id: 'customer-0-base-0', arrivalTick: 0, patience: 3, deadlineTick: 3 }] : [];
    frame = advanceTick(applyAction(prepareTick(frame, { arrivals }), tick === 0 ? 'SERVE' : tick === 114 ? 'COOK' : 'WAIT'));
  }
  frame = prepareTick(frame, { arrivals: [{ id: 'customer-119-base-0', arrivalTick: 119, patience: 3, deadlineTick: 122 }] });
  return { initialState: frame.state, horizonEndTick: 120 as const, futureEvents: [] as never[] };
}

describe('independent stored schedule and replay validation', () => {
  it('replays saved mixed actions while all seed generation, policies and network functions throw', () => {
    const spies = [
      vi.spyOn(demand, 'createDemandSchedule').mockImplementation(() => { throw new Error('seed regeneration forbidden'); }),
      vi.spyOn(demand, 'keyedDraw').mockImplementation(() => { throw new Error('seed draw forbidden'); }),
      vi.spyOn(rules, 'chooseRules').mockImplementation(() => { throw new Error('policy rerun forbidden'); }),
      vi.spyOn(decisions, 'decideOffline').mockImplementation(() => { throw new Error('decision dispatch forbidden'); }),
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('network forbidden'); }),
    ];
    try {
      const result = replayArchive(archive, { configurationHash });
      expect(result.finalHash).toBe(archive.terminal.finalHash);
      expect(result.traceHash).toBe(archive.terminal.traceHash);
      expect(result.score).toEqual(archive.terminal.score);
      expect(result.trace.map(t => t.appliedAction)).toEqual(archive.turns.map(t => t.appliedAction));
      expect(result.networkCalls).toBe(0);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally { for (const spy of spies) spy.mockRestore(); }
  });

  it('replays a saved fallback action without recomputing its rules policy', () => {
    const altered = copy();
    const turn = altered.turns.find(t => t.input.legalActions.length > 1 && rules.chooseRules(t.observation, t.input.legalActions).action === t.appliedAction);
    expect(turn).toBeDefined();
    turn!.decision = decisions.resolveMockOutcome({ state: turn!.observation, legalActions: turn!.input.legalActions, provider: 'jev', outcome: { kind: 'failure', reason: 'timeout', elapsedMs: 4001 } });
    expect(turn!.decision.origin).toBe('fallback');
    expect(turn!.decision.appliedAction).toBe(turn!.appliedAction);
    const policy = vi.spyOn(rules, 'chooseRules').mockImplementation(() => { throw new Error('Fallback recomputation forbidden during replay'); });
    try {
      const result = replayArchive(altered, { configurationHash });
      expect(result.finalHash).toBe(archive.terminal.finalHash);
      expect(result.trace[turn!.tick]!.decision.origin).toBe('fallback');
      expect(policy).not.toHaveBeenCalled();
    } finally { policy.mockRestore(); }
  });

  it.each([0, 30, 60, 90, 120])('validates and resumes the snapshot at sequence %i', snapshotSequence => {
    const replay = replayArchive(archive, { configurationHash, snapshotSequence });
    expect(replay.resumedAt).toBe(snapshotSequence);
    expect(replay.snapshotsVerified).toBe(archive.snapshots.length);
    expect(replay.finalState).toEqual(archive.terminal.frame.state);
    expect(replay.metrics).toEqual(archive.terminal.metrics);
    expect(replay.finalHash).toBe(archive.terminal.finalHash);
  });

  it('rejects an unavailable snapshot and a mismatched configuration/version', () => {
    expect(() => replayArchive(archive, { configurationHash, snapshotSequence: 29 })).toThrow();
    expect(() => replayArchive(archive, { configurationHash: 'f'.repeat(64) })).toThrow();
    const altered = copy();
    (altered.header.contracts as { scorer: string }).scorer = 'utility-unknown';
    expect(() => replayArchive(altered, { configurationHash })).toThrow();
  });

  it('rejects a snapshot diagnostic altered without changing its valid simulator hash', () => {
    const altered = copy();
    altered.snapshots[2]!.stockoutTicks += 1;
    expect(() => replayArchive(altered, { configurationHash, snapshotSequence: 60 })).toThrow(/snapshot/i);
  });

  it('recomputes terminal score and ordered customer resolutions rather than trusting saved summaries', () => {
    const score = copy(); score.terminal.score.profitCents += 1;
    expect(() => replayArchive(score, { configurationHash })).toThrow();
    const resolutions = copy(); resolutions.terminal.resolutions.reverse();
    expect(() => replayArchive(resolutions, { configurationHash })).toThrow();
  });

  it('checks every prepared hash and emitted event sequence', () => {
    const hash = copy(); hash.turns[2]!.preparedHash = 'f'.repeat(64);
    expect(() => replayArchive(hash, { configurationHash })).toThrow();
    const events = copy(); events.turns[2]!.committedEvents = [];
    expect(() => replayArchive(events, { configurationHash })).toThrow();
    const terminal = copy(); terminal.terminal.events = [];
    expect(() => replayArchive(terminal, { configurationHash })).toThrow();
  });

  it('rejects deleted/duplicate/reordered turn records', () => {
    const gap = copy(); gap.turns.splice(12, 1); expect(() => parseArchive(gap, configurationHash)).toThrow();
    const duplicate = copy(); duplicate.turns[13] = structuredClone(duplicate.turns[12]!); expect(() => parseArchive(duplicate, configurationHash)).toThrow();
    const reordered = copy(); [reordered.turns[12], reordered.turns[13]] = [reordered.turns[13]!, reordered.turns[12]!];
    expect(() => parseArchive(reordered, configurationHash)).toThrow();
  });

  it('projects public snapshots through a minimal whitelist', () => {
    const projected = publicSnapshot(archive.snapshots[2]!);
    expect(Object.keys(projected).sort()).toEqual([
      'abandoned','cashCents','phase','profitCents','queueLength','rawPortions','readyPortions',
      'schemaVersion','sequence','served','tick','utilityPoints','wasted',
    ].sort());
    expect(JSON.stringify(projected)).not.toMatch(/seed-|schedule|recentActions|resolutions|customer-|reservation|ledger/);
  });

  it('loads a persisted archive and rejects torn content or public-data pollution', () => {
    const parent = mkdtempSync(join(tmpdir(), 'hawker-p2b-independent-'));
    try {
      const dir = join(parent, 'episode');
      writeEpisodeArchive(dir, archive);
      const loaded = readEpisodeArchive(dir, { expectedConfigurationHash: configurationHash });
      expect(replayArchive(loaded, { configurationHash }).finalHash).toBe(archive.terminal.finalHash);
      expect(() => writeEpisodeArchive(dir, archive)).toThrow();
      const publicPath = join(dir, 'snapshots.public.jsonl');
      writeFileSync(publicPath, readFileSync(publicPath, 'utf8').slice(0, -2));
      expect(() => readEpisodeArchive(dir, { expectedConfigurationHash: configurationHash })).toThrow();
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });

  it('rejects overly broad private archive permissions', () => {
    const parent = mkdtempSync(join(tmpdir(), 'hawker-p2b-permissions-'));
    try {
      const dir = join(parent, 'episode'); writeEpisodeArchive(dir, archive);
      chmodSync(join(dir, 'header.json'), 0o644);
      expect(() => readEpisodeArchive(dir, { expectedConfigurationHash: configurationHash })).toThrow(/permission/i);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
});

describe('independent exact oracle validation', () => {
  it('uses the exact finite-32-bit count probabilities instead of rounded decimal probabilities', () => {
    expect(OFF_PEAK_BASE_COUNT_PROBABILITIES.map(serializeRational)).toEqual([
      { numerator: '1', denominator: '2' },
      { numerator: '1717986919', denominator: '4294967296' },
      { numerator: '429496729', denominator: '4294967296' },
    ]);
    expect(compare(OFF_PEAK_BASE_COUNT_PROBABILITIES.reduce(add, rational(0)), rational(1))).toBe(0);
    const branches = enumerateFutureArrivals(119, { rainActive: true, promotionActive: true });
    const mass = branches.reduce((p, branch) => add(p, branch.probability), rational(0));
    const expectedCount = branches.reduce((p, branch) => add(p, multiply(branch.probability, rational(branch.arrivals.length))), rational(0));
    expect(compare(mass, rational(1))).toBe(0);
    expect(compare(expectedCount, rational(6871947673n, 8589934592n))).toBe(0);
  });

  it('matches hand-computed one-step service and closing utility without future realized draws', () => {
    const result = solveStaticTask(oneStepTask());
    const values = Object.fromEntries(result.actionValues.map(v => [v.action, v.expectedFinalUtility]));
    expect(result.optimalActions).toEqual(['SERVE']);
    expect(values).toEqual({ SERVE: { numerator: '-4400', denominator: '1' }, WAIT: { numerator: '-5055', denominator: '1' } });
    expect(result.exploredBranches).toBe(0);
  });

  it('retains exact rational ties and rejects seed/schedule/horizon injection', () => {
    expect(maximizingActions([
      { action: 'SERVE', value: rational(1, 3) }, { action: 'WAIT', value: rational(2, 6) }, { action: 'COOK', value: rational(0) },
    ])).toEqual(['SERVE', 'WAIT']);
    const task = oneStepTask();
    expect(OracleTaskSchema.safeParse({ ...task, seed: 3 }).success).toBe(false);
    expect(OracleTaskSchema.safeParse({ ...task, schedule: archive.header.schedule }).success).toBe(false);
    expect(OracleTaskSchema.safeParse({ ...task, horizonEndTick: 119 }).success).toBe(false);
    expect(OracleTaskSchema.safeParse({ ...task, futureEvents: [{ type: 'bus', tick: 119 }] }).success).toBe(false);
  });

  it('fails closed on branch limits rather than publishing a partial approximate answer', () => {
    let frame = createInitialFrame();
    for (let tick = 0; tick < 118; tick++) frame = advanceTick(applyAction(prepareTick(frame), 'WAIT'));
    const task = { initialState: prepareTick(frame).state, horizonEndTick: 120 as const, futureEvents: [] as never[] };
    expect(() => solveStaticTask(task, { maxBranches: 1 })).toThrow(OracleLimitError);
  });
});

import {
  createEpisodeReport, exportEpisodeCsv, exportEpisodeJson, exportEpisodeJsonl,
  loadEpisodeCsv, loadEpisodeJson, loadEpisodeJsonl,
} from '../packages/benchmark/src/exports.js';
import { evaluateDataset, freezeStaticDataset, loadStaticDataset, staticDatasetHash } from '../packages/benchmark/src/static-dataset.js';
import { generateStaticCandidates, STATIC_TASK_MANIFEST } from '../packages/benchmark/src/static-tasks.js';

function exportInput() {
  const result = replayArchive(archive, { configurationHash });
  return { ...result, episodeId: archive.header.runId };
}

describe('independent P2-B public export and dataset review', () => {
  it('round-trips JSON/CSV/JSONL with recomputed matching scores and explicit offline classification', () => {
    const input = exportInput();
    const expected = createEpisodeReport(input);
    expect(expected.classification).toBe('offline-development');
    expect(loadEpisodeJson(exportEpisodeJson(input))).toEqual(expected);
    expect(loadEpisodeCsv(exportEpisodeCsv(input))).toEqual(expected);
    const jsonl = loadEpisodeJsonl(exportEpisodeJsonl(input));
    expect(jsonl.report).toEqual(expected);
    expect(jsonl.decisions).toHaveLength(120);
    expect(JSON.stringify(expected)).not.toMatch(/seed-|apiKey|API_KEY|privateToPublicIds/);
  });

  it('rejects changed headline metrics and truncated/duplicate decision exports', () => {
    const input = exportInput();
    const report = JSON.parse(exportEpisodeJson(input));
    report.metrics.utilityPoints += 1;
    expect(() => loadEpisodeJson(JSON.stringify(report))).toThrow();
    const jsonl = exportEpisodeJsonl(input);
    expect(() => loadEpisodeJsonl(jsonl.slice(0, -1))).toThrow();
    const lines = jsonl.trimEnd().split('\n');
    lines[2] = lines[1]!;
    expect(() => loadEpisodeJsonl(`${lines.join('\n')}\n`)).toThrow();
    const csv = exportEpisodeCsv(input);
    expect(() => loadEpisodeCsv(`${csv}${csv.split('\r\n')[1]}\r\n`)).toThrow();
  });

  it('freezes the preregistered manifest and enforces explicit held-out generation opt-in', () => {
    expect(Object.isFrozen(STATIC_TASK_MANIFEST)).toBe(true);
    expect(Object.isFrozen(STATIC_TASK_MANIFEST.taskTicks)).toBe(true);
    expect(() => generateStaticCandidates({ split: 'held-out', seeds: [3000] })).toThrow();
    expect(() => generateStaticCandidates({ split: 'development', seeds: [3000] })).toThrow();
  });

  it('retains oracle-limit rejections and exact-only records in frozen datasets', () => {
    const generation = generateStaticCandidates({ split: 'development', seeds: [2000], behaviorPolicies: ['rules'] });
    const dataset = evaluateDataset(generation, { maxStates: 1, maxBranches: 1 });
    expect(dataset.counts.generated).toBe(3);
    expect(dataset.counts.exactLabeled + dataset.counts.oracleRejected + dataset.counts.duplicates).toBe(dataset.counts.generated);
    expect(dataset.rejections.length).toBeGreaterThan(0);
    expect(dataset.records.every(r => r.oracle.status === 'exact')).toBe(true);
    expect(loadStaticDataset(freezeStaticDataset(dataset))).toEqual(dataset);
    const mutation = structuredClone(dataset);
    mutation.counts.exactLabeled += 1;
    expect(() => loadStaticDataset(JSON.stringify(mutation))).toThrow();
    const inconsistent = structuredClone(dataset);
    const remaining = inconsistent.records[0]!.oracle.actionValues[0]!.expectedRemainingUtility;
    remaining.numerator = (BigInt(remaining.numerator) + BigInt(remaining.denominator)).toString();
    inconsistent.datasetHash = staticDatasetHash(inconsistent);
    expect(() => loadStaticDataset(JSON.stringify(inconsistent))).toThrow();
    for (const record of dataset.records) expect(JSON.stringify(record.task.observation)).not.toMatch(/generator|canonicalStateHash|seed-|"seed"|optimalActions/);
  });
});

describe('independent stored-schedule structural integrity', () => {
  it('validates saved contents without regenerating the seed-derived random schedule', () => {
    const original = demand.createDemandSchedule(0);
    const changed = { ...structuredClone(original), seed: 1,
      ticks: original.ticks.map(row => row.map(a => ({ ...a, id: a.id.replace(/^seed-0:/, 'seed-1:') }))),
      privateToPublicIds: {} as Record<string, string>,
    };
    changed.privateToPublicIds = Object.fromEntries(changed.ticks.flat().map(a => [a.id, a.publicId]));
    // The saved, hash-identified input is authoritative. No claim that these are seed1's regenerated draws.
    expect(StoredScheduleSchema.safeParse(rehashStoredSchedule(changed)).success).toBe(true);
  });

  it('rejects a repaired checksum on nonconsecutive source ordinals', () => {
    const original = demand.createDemandSchedule(0);
    const changed = { ...structuredClone(original), ticks: original.ticks.map((row, tick) => row.map(a =>
      tick === 60 && a.source === 'base' && a.ordinal === 1
        ? { ...a, ordinal: 2, id: 'seed-0:customer-60-base-2', publicId: 'customer-60-base-2' }
        : { ...a },
    )), privateToPublicIds: {} as Record<string, string> };
    changed.privateToPublicIds = Object.fromEntries(changed.ticks.flat().map(a => [a.id, a.publicId]));
    expect(StoredScheduleSchema.safeParse(rehashStoredSchedule(changed)).success).toBe(false);
  });
});
