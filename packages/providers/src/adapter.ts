import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { DecisionInputSchema, DecisionResultSchema, IdentifierSchema, type DecisionInput, type DecisionResult } from '../../shared/src/schemas.js';
import { chooseRules } from '../../decisions/src/rules.js';
import { canonicalState as canonicalJson } from '../../simulation/src/hash.js';
import { activationBlockers, requestAccounting, ProviderRuntimeSchema, type LiveProvider, type ProviderRuntimeConfig } from './activation.js';
import { buildRequest, parseResponse, WireContractError, type ProbabilityDiagnostic } from './wire.js';
import type { Ledger } from './ledger.js';

export interface AdapterOptions {
  provider: LiveProvider;
  config: ProviderRuntimeConfig;
  ledger: Ledger;
  mode?: 'smoke'|'live';
  /** Tests only; production defaults to the inherited server-side environment and fetch. */
  fetch?: typeof globalThis.fetch;
  credential?: () => string|undefined;
  /** Explicit offline-state experiments; the resulting body participates in the durable input hash. */
  requestBuilder?: typeof buildRequest;
}
export interface LiveTurn {
  mode: 'live'; origin: 'provider'|'fallback'|'forced_wait'|'recovered';
  attemptedProvider: LiveProvider|null; attemptCount: 0|1;
  result: DecisionResult;
  nativeUsage?: ReturnType<typeof parseResponse>['nativeUsage'];
  diagnostic: string|null;
  probabilityDiagnostic?: ProbabilityDiagnostic;
}
class TransportFailure extends Error {
  constructor(readonly reason: 'timeout'|'network'|'invalid'|'rate-limit') { super(reason); }
}
function fallback(input: DecisionInput, provider: LiveProvider, reason: NonNullable<DecisionResult['fallbackReason']>, elapsed: number): DecisionResult {
  return DecisionResultSchema.parse({provider, action:null, status:'fallback', latencyMs:elapsed,
    appliedAction:chooseRules(input.observation,input.legalActions).action, fallbackPolicy:'rules-1', fallbackReason:reason});
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new TransportFailure('invalid');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 65_536) { void reader.cancel().catch(()=>{}); throw new TransportFailure('invalid'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof TransportFailure) throw error;
    throw new TransportFailure('invalid');
  } finally { reader.releaseLock(); }
}
/** One captured decision, one durable intent, at most one HTTP POST. No retry path. */
export function createProviderAdapter(options: AdapterOptions) {
  const config = ProviderRuntimeSchema.parse(options.config);
  const provider = options.provider;
  const fetcher = options.fetch ?? globalThis.fetch;
  const mode = options.mode ?? 'live';
  const credential = options.credential ?? (()=>process.env[provider === 'jev' ? 'TYPESAFE_API_KEY' : 'ZOOM_AI_SERVICES_API_KEY']);
  async function decideTurn(value: DecisionInput): Promise<LiveTurn> {
    const started = performance.now();
    const wallStarted = Date.now();
    const elapsed = ()=>Math.max(0,Math.ceil(performance.now()-started));
    // Capture and validate BEFORE any async boundary, billing reservation or request construction.
    const input = DecisionInputSchema.parse(value);
    const fail = (reason: NonNullable<DecisionResult['fallbackReason']>, diagnostic: string, count: 0|1 = 0): LiveTurn => ({
      mode:'live',origin:'fallback',attemptedProvider:provider,attemptCount:count,
      result:fallback(input,provider,reason,elapsed()),diagnostic,
    });
    if (input.legalActions.length === 1) return {mode:'live',origin:'forced_wait',attemptedProvider:null,attemptCount:0,
      result:{provider:'rules',action:'WAIT',status:'success',latencyMs:0,modelVersion:'rules-1'},diagnostic:null};
    const blockers = activationBlockers(config,provider,mode);
    if (blockers.length) return fail('budget',blockers.join(','));
    const settings = config.providers[provider];
    const bound = requestAccounting(config,provider,mode,input.roundId);
    if(!bound)return fail('budget','round-not-approved-or-accounting-unavailable');
    const key = credential();
    if (!key) return fail('network','credential-unavailable');
    // Node's startup switch makes native fetch honor the managed HTTP(S) proxy and CA trust.
    if (!options.fetch && (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) &&
        process.env.NODE_USE_ENV_PROXY !== '1' && !process.execArgv.includes('--use-env-proxy')) {
      return fail('network','start-node-with-env-proxy');
    }
    const request = (options.requestBuilder ?? buildRequest)(provider,input,settings.model!);
    const body = JSON.stringify(request.body);
    if (Buffer.byteLength(body,'utf8') > bound.maxRequestBytes) return fail('quota','verified-request-size-bound-exceeded');
    const inputHash = createHash('sha256').update(canonicalJson({input,requestedModel:request.requestedModel,body:request.body})).digest('hex');
    let attempt: ReturnType<Ledger['reserveAttempt']>;
    try {
      const prior = options.ledger.lookupAttempt({runId:input.roundId,tick:input.tick,provider});
      if (prior) {
        if (prior.inputHash !== inputHash) return fail('uncertain','attempt-input-mismatch');
        if (prior.result) return {mode:'live',origin:'recovered',attemptedProvider:provider,attemptCount:0,result:prior.result,
          ...(prior.nativeUsage?{nativeUsage:prior.nativeUsage}:{}),diagnostic:'durable-result-reused'};
        return fail('uncertain','existing-attempt-no-redispatch');
      }
      if (options.ledger.config.campaignId !== config.campaignId || options.ledger.getCostBound(provider) !== bound.micros) return fail('budget','ledger-configuration-mismatch');
      attempt = options.ledger.reserveAttempt({runId:input.roundId,tick:input.tick,provider,inputHash,costBoundMicros:bound.micros,deadlineAtMs:wallStarted+4000});
      options.ledger.markDispatchIntent(attempt.id);
    } catch (error) {
      const code = error && typeof error==='object' && 'code' in error ? error.code : '';
      return fail(code==='budget'?'budget':code==='quota'?'quota':code==='rate-limit'?'rate-limit':'uncertain','reservation-or-intent-rejected');
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>|undefined;
    let result: LiveTurn;
    try {
      const remaining = 4000-(performance.now()-started);
      if (remaining<=0) throw new TransportFailure('timeout');
      const timeout = new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{controller.abort();reject(new TransportFailure('timeout'));},remaining);
      });
      const responseTask = (async()=>{
        const response = await fetcher(request.endpoint,{
          method:'POST',redirect:'error',signal:controller.signal,
          headers:provider==='jev'?{'content-type':'application/json',authorization:`Bearer ${key}`}:{'content-type':'application/json','x-api-key':key},body,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(()=>{});
          throw new TransportFailure(response.status===429?'rate-limit':'network');
        }
        const raw = await boundedJson(response);
        const parsed = parseResponse(provider,input,request.requestedModel,raw,elapsed());
        // Jev's documented SDK metadata obtains this ID from the HTTP header, not the JSON body.
        if (provider === 'jev') {
          const headerId = response.headers.get('x-typesafe-request-id');
          if (headerId !== null) {
            const checked = IdentifierSchema.safeParse(headerId);
            if (!checked.success || (parsed.result.requestId && parsed.result.requestId !== checked.data)) throw new TransportFailure('invalid');
            parsed.result.requestId = checked.data;
          }
        }
        if (JSON.stringify(parsed).includes(key)) throw new TransportFailure('invalid');
        if (performance.now()-started >=4000 || controller.signal.aborted) throw new TransportFailure('timeout');
        return parsed;
      })();
      const parsed = await Promise.race([responseTask,timeout]);
      result={mode:'live',origin:'provider',attemptedProvider:provider,attemptCount:1,result:parsed.result,
        ...(parsed.nativeUsage?{nativeUsage:parsed.nativeUsage}:{}),diagnostic:null};
      options.ledger.finishAttempt(attempt.id,{status:'success',result:parsed.result,
        ...(parsed.nativeUsage?{nativeUsage:parsed.nativeUsage}:{})});
    } catch (error) {
      // Never expose SDK/fetch messages, raw payloads, headers or secrets in diagnostics.
      const reason = controller.signal.aborted ? 'timeout' : error instanceof TransportFailure ? error.reason : error instanceof Error && error.name==='WireContractError' ? 'invalid' : 'network';
      result=fail(reason,error instanceof WireContractError ? `wire-contract:${error.code}` : `provider-request-failed:${reason}`,1);
      if (error instanceof WireContractError && error.probabilityDiagnostic) result.probabilityDiagnostic = error.probabilityDiagnostic;
      try { options.ledger.finishAttempt(attempt.id,{status:'uncertain'}); } catch { /* Existing durable intent already prevents retransmission. */ }
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
    return result;
  }
  return {decideTurn, async decide(input: DecisionInput): Promise<DecisionResult> { return (await decideTurn(input)).result; }};
}
