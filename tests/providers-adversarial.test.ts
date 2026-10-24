import { describe, expect, it } from 'vitest';
import { DecisionInputSchema, type DecisionInput } from '../packages/shared/src/index.js';
import { readProjectJson } from '../scripts/config-snapshot.js';
import {
  buildRequest, canonicalDecisionContext, ForcedWaitError, parseResponse, WireContractError,
} from '../packages/providers/src/wire.js';

function input(): DecisionInput {
  const observation = readProjectJson('fixtures/observation-2-initial.json') as DecisionInput['observation'];
  return DecisionInputSchema.parse({ roundId: '34801eca-7cd6-4c23-a116-8aee7db040ae', tick: observation.tick, observation, legalActions: observation.legalActions });
}
function zoomResponse(captured: DecisionInput) {
  return {
    model: 'zoom-decisions', request_id: 'safe-request-1',
    answers: [{ name: 'action', type: 'choice', choice: captured.legalActions[0],
      probabilities: captured.legalActions.map(value => ({ value, probability: 1 / captured.legalActions.length })),
    }], usage: { input_units: 100, output_units: 2, unit_type: 'tokens', details: { cached_input_tokens: 20 } },
  };
}

describe('independent provider wire conformance', () => {
  it('sends byte-equivalent semantic context to Jev and both Zoom policies', () => {
    const captured = input();
    const jev = buildRequest('jev', captured, 'jev-test-202610');
    const standard = buildRequest('zoom', captured);
    const pro = buildRequest('zoom-pro', captured);
    expect(jev.body.state).toBe(standard.body.input);
    expect(pro.body.input).toBe(standard.body.input);
    expect(standard.body.input).toBe(canonicalDecisionContext(captured));
    expect(standard.requestedModel).toBe('zoom-decisions-standard');
    expect(pro.requestedModel).toBe('zoom-decisions-pro');
    expect(JSON.stringify(standard.body)).not.toContain(captured.roundId);
    expect(JSON.stringify(standard.body)).not.toMatch(/seed-|privateToPublicIds|oracle|API_KEY/);
  });

  it('rejects private input fields and malformed legal action ordering before request construction', () => {
    const captured = input();
    const polluted = { ...captured, observation: { ...captured.observation, seed: 22 } };
    expect(() => buildRequest('zoom', polluted)).toThrow(WireContractError);
    expect(() => buildRequest('zoom', { ...captured, legalActions: [...captured.legalActions].reverse() })).toThrow();
  });

  it('does not fabricate a Jev model or replace Pro with the Standard response alias', () => {
    const captured = input();
    expect(() => buildRequest('jev', captured)).toThrow(WireContractError);
    expect(() => parseResponse('zoom-pro', captured, 'zoom-decisions-pro', zoomResponse(captured), 5)).toThrow(WireContractError);
  });

  it('recognizes the documented Standard alias while keeping native units separate from tokens/cost', () => {
    const captured = input();
    const parsed = parseResponse('zoom', captured, 'zoom-decisions-standard', zoomResponse(captured), 5);
    expect(parsed.result).toMatchObject({ provider: 'zoom', modelVersion: 'zoom-decisions', requestId: 'safe-request-1', latencyMs: 5 });
    expect(parsed.result.confidence).toBeUndefined();
    expect(parsed.result.usage).toBeUndefined();
    expect(parsed.nativeUsage).toEqual({ schemaVersion: 'provider-native-usage-1', provider: 'zoom', inputUnits: 100, outputUnits: 2, unitType: 'tokens', cachedInputTokens: 20 });
    const resultText = JSON.stringify(parsed.result);
    expect(resultText).not.toMatch(/costMicros|inputTokens|currency/);
  });

  it('retains explicitly returned Jev token counts while leaving missing/null counts absent', () => {
    const captured = input();
    const base = {
      model: 'jev-test-202610', request_id: 'safe-request-2',
      answers: { action: { type: 'choice', choice: captured.legalActions[0],
        probabilities: Object.fromEntries(captured.legalActions.map(a => [a, 1 / captured.legalActions.length])),
      } }, usage: { input_tokens: 100, output_tokens: null },
    };
    const parsed = parseResponse('jev', captured, 'jev-test-202610', base, 5);
    expect(parsed.result.usage).toEqual({ inputTokens: 100 });
    expect(parsed.result.confidence).toBeUndefined();
    expect(parsed.nativeUsage?.outputUnits).toBeUndefined();
  });

  it('validates answer count, stable name, type and refusal without inventing an action', () => {
    const captured = input();
    const original = zoomResponse(captured);
    const duplicate = structuredClone(original); duplicate.answers.push(structuredClone(duplicate.answers[0]!));
    expect(() => parseResponse('zoom', captured, 'zoom-decisions-standard', duplicate, 5)).toThrow();
    const wrongName = structuredClone(original); wrongName.answers[0]!.name = 'other';
    expect(() => parseResponse('zoom', captured, 'zoom-decisions-standard', wrongName, 5)).toThrow();
    const refusal = { model: 'zoom-decisions', answers: [{ name: 'action', type: 'refusal' }] };
    expect(() => parseResponse('zoom', captured, 'zoom-decisions-standard', refusal, 5)).toThrow(WireContractError);
  });

  it('rejects probability omissions, duplicates, illegal values and non-unit distributions', () => {
    const captured = input();
    const omission = zoomResponse(captured); omission.answers[0]!.probabilities.pop();
    expect(() => parseResponse('zoom', captured, 'zoom-decisions-standard', omission, 5)).toThrow();
    const duplicate = zoomResponse(captured); duplicate.answers[0]!.probabilities[1]!.value = duplicate.answers[0]!.probabilities[0]!.value;
    expect(() => parseResponse('zoom', captured, 'zoom-decisions-standard', duplicate, 5)).toThrow();
    const invalid = zoomResponse(captured); invalid.answers[0]!.probabilities[0]!.probability = Number.NaN;
    expect(() => parseResponse('zoom', captured, 'zoom-decisions-standard', invalid, 5)).toThrow();
    const sum = zoomResponse(captured); for (const p of sum.answers[0]!.probabilities) p.probability = 0;
    expect(() => parseResponse('zoom', captured, 'zoom-decisions-standard', sum, 5)).toThrow();
  });

  it('does not rename the winning choice probability or unsupported Zoom confidence to confidence', () => {
    const captured = input();
    const raw = zoomResponse(captured);
    const parsed = parseResponse('zoom', captured, 'zoom-decisions-standard', { ...raw, answers: raw.answers.map(a => ({ ...a, confidence: 0.99 })) }, 5);
    expect(parsed.result.probabilities).toBeDefined();
    expect(parsed.result.confidence).toBeUndefined();
    expect(parsed.result.confidenceSemantics).toBeUndefined();
  });

  it('fails closed for illegal returned action, invalid usage and late completion', () => {
    const captured = input();
    const illegal = { ...zoomResponse(captured), answers: [{ name: 'action', type: 'choice', choice: 'SERVE' }] };
    expect(captured.legalActions).not.toContain('SERVE');
    expect(() => parseResponse('zoom', captured, 'zoom-decisions-standard', illegal, 5)).toThrow();
    const badUsage = { ...zoomResponse(captured), usage: { input_units: -1, output_units: 0, unit_type: 'tokens' } };
    expect(() => parseResponse('zoom', captured, 'zoom-decisions-standard', badUsage, 5)).toThrow();
    expect(() => parseResponse('zoom', captured, 'zoom-decisions-standard', zoomResponse(captured), 4001)).toThrow();
    expect(parseResponse('zoom', captured, 'zoom-decisions-standard', zoomResponse(captured), 4000).result.status).toBe('success');
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { configurationHash } from '../scripts/config-snapshot.js';
import { createProviderAdapter } from '../packages/providers/src/adapter.js';
import { activationBlockers, ProviderRuntimeSchema, type ProviderRuntimeConfig } from '../packages/providers/src/activation.js';
import { initializeLedger, openLedger, type Ledger } from '../packages/providers/src/ledger.js';

function runtimeConfig(costBoundMicros = 100): ProviderRuntimeConfig {
  const config = ProviderRuntimeSchema.parse(readProjectJson('manifests/provider-runtime.json'));
  for (const provider of ['zoom', 'zoom-pro'] as const) config.providers[provider].maximumRequestCost = {
    micros: costBoundMicros, currency: 'USD', evidenceUrl: 'https://example.test/verified-test-only-bound',
    checkedAt: '2026-10-23T00:00:00Z', maxRequestBytes: 65536,
  };
  return config;
}
async function withLedger(operation: (ledger: Ledger, dir: string, config: ProviderRuntimeConfig) => Promise<void>, costBoundMicros = 100) {
  const root = mkdtempSync(join(tmpdir(), 'hawker-provider-review-'));
  const dir = join(root, 'ledger');
  const config = runtimeConfig(costBoundMicros);
  const ledger = initializeLedger(dir, {
    schemaVersion: 'provider-ledger-1', campaignId: config.campaignId, configurationHash,
    pools: [{ id: 'zoom-shared', providers: ['zoom', 'zoom-pro'], perRunCapMicros: 250000, campaignCapMicros: 5000000 }],
    verifiedCostBounds: { zoom: { costBoundMicros, evidenceId: 'test-only-independent-review' }, 'zoom-pro': { costBoundMicros, evidenceId: 'test-only-independent-review' } },
  });
  try { await operation(ledger, dir, config); } finally { ledger.close(); rmSync(root, { recursive: true, force: true }); }
}
const sensitiveTestKey = 'independent-test-credential-sentinel';
const jsonResponse = (captured: DecisionInput) => new Response(JSON.stringify(zoomResponse(captured)), { status: 200, headers: { 'content-type': 'application/json' } });

describe('independent provider adapter activation and durable safety review', () => {
  it('requires the smoke returned model to verify each policy identity, allowing only the Standard alias', () => {
    const config = runtimeConfig();
    config.providers.zoom.smoke = {
      requestId: 'smoke-standard', requestedModel: 'zoom-decisions-standard',
      returnedModel: 'zoom-decisions', checkedAt: '2026-10-23T00:00:00Z',
    };
    config.providers['zoom-pro'].smoke = {
      requestId: 'smoke-pro', requestedModel: 'zoom-decisions-pro',
      returnedModel: 'zoom-decisions', checkedAt: '2026-10-23T00:00:00Z',
    };
    expect(activationBlockers(config, 'zoom', 'live')).toEqual([]);
    expect(activationBlockers(config, 'zoom-pro', 'live')).toContain('credentialed-smoke-pending');
    config.providers['zoom-pro'].smoke!.returnedModel = 'zoom-decisions-pro';
    expect(activationBlockers(config, 'zoom-pro', 'live')).toEqual([]);
    config.providers.zoom.smoke!.returnedModel = 'zoom-decisions-pro';
    expect(activationBlockers(config, 'zoom', 'live')).toContain('credentialed-smoke-pending');
  });

  it('blocks missing cost evidence or smoke before reading credentials or invoking fetch', async () => {
    await withLedger(async (ledger, _dir, config) => {
      const fetcher = vi.fn<typeof globalThis.fetch>(async () => { throw new Error('Must not dispatch'); });
      const credential = vi.fn(() => sensitiveTestKey);
      const noBound = structuredClone(config); noBound.providers.zoom.maximumRequestCost = null;
      const blocked = await createProviderAdapter({ provider: 'zoom', config: noBound, ledger, mode: 'smoke', fetch: fetcher, credential }).decideTurn(input());
      expect(blocked).toMatchObject({ origin: 'fallback', attemptCount: 0 });
      expect(blocked.diagnostic).toContain('maximum-request-charge-unverified');
      config.providers.zoom.smoke = null; // Explicit missing-receipt fixture, independent of recorded live smokes.
      const noSmoke = await createProviderAdapter({ provider: 'zoom', config, ledger, mode: 'live', fetch: fetcher, credential }).decideTurn(input());
      expect(noSmoke.diagnostic).toContain('credentialed-smoke-pending');
      expect(fetcher).not.toHaveBeenCalled(); expect(credential).not.toHaveBeenCalled();
      expect(ledger.summary().attempts).toBe(0);
    });
  });

  it('keeps sole WAIT local with no credential access or budget reservation', async () => {
    await withLedger(async (ledger, _dir, config) => {
      const source = input();
      source.tick = 119; source.observation.tick = 119; source.observation.remainingMinutes = 1;
      source.observation.readyBatches = []; source.observation.totals.wasted = 12;
      source.legalActions = ['WAIT']; source.observation.legalActions = ['WAIT'];
      const fetcher = vi.fn<typeof globalThis.fetch>(async () => { throw new Error('Must not dispatch'); });
      const credential = vi.fn(() => sensitiveTestKey);
      expect(() => buildRequest('zoom', source)).toThrow(ForcedWaitError);
      const turn = await createProviderAdapter({ provider: 'zoom', config, ledger, mode: 'smoke', fetch: fetcher, credential }).decideTurn(source);
      expect(turn).toMatchObject({ origin: 'forced_wait', attemptedProvider: null, attemptCount: 0 });
      expect(fetcher).not.toHaveBeenCalled(); expect(credential).not.toHaveBeenCalled();
      expect(ledger.summary().attempts).toBe(0);
    });
  });

  it('disallows redirects, dispatches once and recovers a durable result without another call', async () => {
    await withLedger(async (ledger, dir, config) => {
      const captured = input();
      const fetcher = vi.fn<typeof globalThis.fetch>(async (_url, _init) => jsonResponse(captured));
      const adapter = createProviderAdapter({ provider: 'zoom', config, ledger, mode: 'smoke', fetch: fetcher, credential: () => sensitiveTestKey });
      const original = await adapter.decideTurn(captured);
      expect(original).toMatchObject({ origin: 'provider', attemptCount: 1 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]![0]).toBe('https://api.zoom.us/v2/aiservices/decisions/decide');
      expect(fetcher.mock.calls[0]![1]?.redirect).toBe('error');
      const reopened = openLedger(dir, { campaignId: config.campaignId, configurationHash });
      try {
        const recovered = await createProviderAdapter({ provider: 'zoom', config, ledger: reopened, mode: 'smoke', fetch: fetcher, credential: () => sensitiveTestKey }).decideTurn(captured);
        expect(recovered).toMatchObject({ origin: 'recovered', attemptCount: 0 });
        expect(recovered.result).toEqual(original.result);
        expect(recovered.nativeUsage).toEqual(original.nativeUsage);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(reopened.summary().pools[0]!.reservedMicros).toBe(100);
      } finally { reopened.close(); }
    });
  });

  it('records a bounded wire validation code without retaining the raw response', async () => {
    await withLedger(async (ledger, _dir, config) => {
      const captured = input();
      const fetcher = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
        model: 'zoom-decisions', answers: [{name: 'action', type: 'choice', choice: 'SERVE'}], debug: sensitiveTestKey,
      })));
      const turn = await createProviderAdapter({provider: 'zoom', config, ledger, mode: 'smoke', fetch: fetcher, credential: () => sensitiveTestKey}).decideTurn(captured);
      expect(turn.diagnostic).toBe('wire-contract:illegal-action');
      expect(JSON.stringify(turn)).not.toContain(sensitiveTestKey);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  it('passes bounded probability diagnostics through the adapter without retries', async () => {
    await withLedger(async (ledger, _dir, config) => {
      const fetcher = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
        model: 'zoom-decisions', answers: [{name:'action',type:'choice',choice:'WAIT',probabilities:[{value:'WAIT',probability:0.99}]}], debug:sensitiveTestKey,
      })));
      const turn = await createProviderAdapter({provider:'zoom',config,ledger,mode:'smoke',fetch:fetcher,credential:()=>sensitiveTestKey}).decideTurn(input());
      expect(turn.diagnostic).toBe('wire-contract:invalid-probabilities');
      expect(turn.probabilityDiagnostic).toMatchObject({shapeValid:true,sum:0.99,invalidValueCount:0});
      expect(turn.probabilityDiagnostic!.missingLabels).toContain('RESTOCK');
      expect(JSON.stringify(turn)).not.toContain(sensitiveTestKey);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  it('redacts transport errors and does not retry even when the error contains the credential', async () => {
    await withLedger(async (ledger, _dir, config) => {
      const fetcher = vi.fn<typeof globalThis.fetch>(async () => { throw new Error(`Injected upstream error ${sensitiveTestKey}`); });
      const captured = input();
      const adapter = createProviderAdapter({ provider: 'zoom', config, ledger, mode: 'smoke', fetch: fetcher, credential: () => sensitiveTestKey });
      const failed = await adapter.decideTurn(captured);
      const repeated = await adapter.decideTurn(captured);
      expect(failed).toMatchObject({ origin: 'fallback', attemptCount: 1 });
      expect(repeated).toMatchObject({ origin: 'fallback', attemptCount: 0 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(JSON.stringify({ failed, repeated, attempt: ledger.lookupAttempt({ runId: captured.roundId, tick: captured.tick, provider: 'zoom' }) })).not.toContain(sensitiveTestKey);
      expect(ledger.summary().pools[0]!.reservedMicros).toBe(100);
    });
  });

  it('rejects a successful payload reflecting the credential into request metadata', async () => {
    await withLedger(async (ledger, _dir, config) => {
      const captured = input();
      const fetcher = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ ...zoomResponse(captured), request_id: sensitiveTestKey })));
      const turn = await createProviderAdapter({ provider: 'zoom', config, ledger, mode: 'smoke', fetch: fetcher, credential: () => sensitiveTestKey }).decideTurn(captured);
      expect(turn.origin).toBe('fallback');
      const saved = ledger.lookupAttempt({ runId: captured.roundId, tick: captured.tick, provider: 'zoom' });
      expect(JSON.stringify({ turn, saved })).not.toContain(sensitiveTestKey);
    });
  });

  it('captures the original decision input before awaiting a response', async () => {
    await withLedger(async (ledger, _dir, config) => {
      const source = input(), original = structuredClone(source);
      let resolveFetch!: (response: Response) => void;
      const fetcher = vi.fn<typeof globalThis.fetch>(() => new Promise(resolve => { resolveFetch = resolve; }));
      const pending = createProviderAdapter({ provider: 'zoom', config, ledger, mode: 'smoke', fetch: fetcher, credential: () => sensitiveTestKey }).decideTurn(source);
      source.legalActions = ['SERVE', 'WAIT']; source.observation.legalActions = ['SERVE', 'WAIT'];
      source.observation.cashCents = 999;
      resolveFetch(jsonResponse(original));
      const turn = await pending;
      expect(turn.origin).toBe('provider');
      expect(turn.result.action).toBe(original.legalActions[0]);
      expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).input).toBe(canonicalDecisionContext(original));
    });
  });

  it('allows simultaneous Standard/Pro dispatch and charges one shared run cap', async () => {
    await withLedger(async (ledger, _dir, config) => {
      const captured = input();
      const fetcher = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const response = zoomResponse(captured);
        if (body.model === 'zoom-decisions-pro') response.model = 'zoom-decisions-pro';
        return new Response(JSON.stringify(response));
      });
      const [standard, pro] = await Promise.all((['zoom', 'zoom-pro'] as const).map(provider =>
        createProviderAdapter({ provider, config, ledger, mode: 'smoke', fetch: fetcher, credential: () => sensitiveTestKey }).decideTurn(captured),
      ));
      expect([standard!.origin, pro!.origin]).toEqual(['provider', 'provider']);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(ledger.summary().pools[0]!.reservedMicros).toBe(250000);
      const next = structuredClone(captured); next.roundId = captured.roundId;
      next.tick = 1; next.observation.tick = 1; next.observation.remainingMinutes = 119;
      const exhausted = await createProviderAdapter({ provider: 'zoom', config, ledger, mode: 'smoke', fetch: fetcher, credential: () => sensitiveTestKey }).decideTurn(next);
      expect(exhausted.result.fallbackReason).toBe('budget');
      expect(fetcher).toHaveBeenCalledTimes(2);
    }, 125000);
  });

  it('times out stalled body consumption, retains the charge and never redispatches', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      await withLedger(async (ledger, _dir, config) => {
        let streamController!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
        let signal: AbortSignal | undefined;
        const fetcher = vi.fn<typeof globalThis.fetch>(async (_url, init) => { signal = init?.signal as AbortSignal; return new Response(body); });
        const captured = input();
        const adapter = createProviderAdapter({ provider: 'zoom', config, ledger, mode: 'smoke', fetch: fetcher, credential: () => sensitiveTestKey });
        const pending = adapter.decideTurn(captured);
        await vi.advanceTimersByTimeAsync(4001);
        const timedOut = await pending;
        expect(timedOut.result.fallbackReason).toBe('timeout');
        expect(signal?.aborted).toBe(true);
        expect(ledger.summary().pools[0]!.reservedMicros).toBe(100);
        const again = await adapter.decideTurn(captured);
        expect(again.attemptCount).toBe(0); expect(fetcher).toHaveBeenCalledTimes(1);
        streamController.close();
      });
    } finally { vi.useRealTimers(); }
  });
});
