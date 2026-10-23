import { parsePublicView, type PublicView, type PublicViewEvent } from '../../../packages/live/src/public-view.ts';

export interface LiveViewerState {
  connection: 'loading' | 'connected' | 'disconnected' | 'unavailable';
  view: PublicView | null;
  cursor: number;
  history: PublicViewEvent[];
  error: string | null;
}
export function initialLiveViewerState(): LiveViewerState {
  return { connection: 'loading', view: null, cursor: 0, history: [], error: null };
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function discard(response: Response) { void response.body?.cancel().catch(() => {}); }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
/** Accept only a complete, correlated page. Existing committed boundaries are immutable. */
export function reconcileLiveView(state: LiveViewerState, value: unknown, request: { roundId: string; afterSequence: number }): LiveViewerState {
  const view = parsePublicView(value, request);
  const old = state.view;
  if (old !== null) {
    if (view.snapshot.sequence < old.snapshot.sequence || view.snapshot.control_revision < old.snapshot.control_revision ||
      view.server_time_ms < old.server_time_ms || view.snapshot.classification !== old.snapshot.classification ||
      view.snapshot.configuration_hash !== old.snapshot.configuration_hash ||
      (view.snapshot.control_revision === old.snapshot.control_revision && view.snapshot.control_state !== old.snapshot.control_state) ||
      (view.snapshot.sequence === old.snapshot.sequence && !same(view.snapshot.snapshot, old.snapshot.snapshot))) throw new Error('Regressed public view');
    if (old.vote_result !== null && (view.vote_result === null ||
      !same({ ...old.vote_result, applied: true }, { ...view.vote_result, applied: true }) ||
      (old.vote_result.applied && !view.vote_result.applied))) throw new Error('Changed vote result');
  }
  const events = new Map(state.history.map(item => [item.sequence, item]));
  for (const item of view.events.events) {
    const prior = events.get(item.sequence);
    if (prior !== undefined && !same(prior, item)) throw new Error('Changed committed event');
    events.set(item.sequence, item);
  }
  const history = [...events.values()].sort((a, b) => a.sequence - b.sequence);
  if (history.length > 121 || history.some((item, index) => item.sequence !== index + 1)) throw new Error('Missing committed event');
  return { connection: 'connected', view, history, cursor: view.events.events.at(-1)?.sequence ?? request.afterSequence, error: null };
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error();
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 262_144)) throw new Error();
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 262_144) throw new Error();
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}
export function createLiveViewer(options: { roundId: string; onChange: (state: LiveViewerState) => void; fetch?: typeof fetch }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.roundId)) throw new Error('Invalid round');
  const roundId = options.roundId.toLowerCase(), transport = options.fetch ?? fetch;
  let state = initialLiveViewerState(), running = false, generation = 0, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined, active: AbortController | null = null;
  function emit(next: LiveViewerState) { state = freeze(next); options.onChange(state); }
  function schedule(ms: number, epoch: number) { timer = setTimeout(() => { if (running && generation === epoch) void poll(epoch); }, ms); }
  async function poll(epoch: number) {
    const afterSequence = state.cursor;
    const controller = new AbortController(); active = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Read timeout')); }, 10_000); });
    try {
      const response = await Promise.race([transport(`/api/live/rounds/${roundId}?after=${afterSequence}&limit=100`, {
        method: 'GET', cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal,
      }), deadline]);
      if (!running || epoch !== generation) { discard(response); return; }
      if (response.status === 404) {
        discard(response); failures = 0;
        emit({ ...initialLiveViewerState(), connection: 'unavailable', error: 'This round is unavailable.' });
        schedule(15_000, epoch); return;
      }
      if (response.status === 409) { discard(response); state = { ...state, cursor: 0 }; throw new Error('Cursor requires recovery'); }
      if (!response.ok) { discard(response); throw new Error('Read unavailable'); }
      const body = await Promise.race([boundedJson(response, controller.signal), deadline]);
      if (!running || epoch !== generation) return;
      let next: LiveViewerState;
      try { next = reconcileLiveView(state, body, { roundId, afterSequence }); }
      catch { state = { ...state, cursor: 0 }; throw new Error('Invalid shared round data'); }
      failures = 0; emit(next);
      schedule(next.cursor < next.view!.events.high_water ? 0 : 2000, epoch);
    } catch {
      if (!running || epoch !== generation) return;
      failures++;
      emit({ ...state, connection: 'disconnected', error: 'Connection lost. Showing the last confirmed update.' });
      schedule(Math.min(15_000, 2000 * 2 ** Math.min(failures - 1, 3)), epoch);
    } finally { clearTimeout(timeout); controller.abort(); if (active === controller) active = null; }
  }
  function stop() { running = false; generation++; clearTimeout(timer); active?.abort(); active = null; }
  function start() {
    if (running) return;
    running = true; const epoch = ++generation;
    emit({ ...state, connection: 'loading', error: null }); void poll(epoch);
  }
  return { start, stop, reconnect() { stop(); failures = 0; start(); }, getState: () => state };
}
