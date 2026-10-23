import { mkdirSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const roundId = '11111111-1111-4111-8111-111111111111';
const livePath = `/live/${roundId}`;
type Option = 'bus' | 'rain' | 'supplier-delay';
type Receipt = { schemaVersion: 'live-vote-receipt-1'; round_id: string; window_index: 0; request_id: string; option_id: Option; accepted_at_ms: number; replayed: boolean };
type PublicState = { tick: number; revision: number; control: 'active' | 'paused' | 'stopped'; unavailable: boolean; disconnected: boolean; malformedOnce: boolean; deadline: number };
function publicState(): PublicState { return { tick: 30, revision: 0, control: 'active', unavailable: false, disconnected: false, malformedOnce: false, deadline: Date.now() + 20_000 }; }
function envelope(state: PublicState, after: number, limit: number) {
  const now = Date.now(), sequence = state.tick + 1;
  const policies = [{ policy_id: 'rules', cash_cents: 22500, profit_cents: 2500, utility_points: 2750, served: 11, abandoned: 2 }];
  const open = state.deadline > now && state.control !== 'stopped';
  const windowStatus = state.control === 'stopped' ? 'disabled' : open ? 'open' : 'locked';
  const paused = state.control === 'paused';
  const events = Array.from({ length: Math.min(limit, Math.max(0, sequence - after)) }, (_, index) => {
    const boundary = after + index + 1;
    return { round_id: roundId, sequence: boundary, tick: boundary - 1, event_type: boundary === 121 ? 'round-closed' : 'tick-committed', snapshot: { policies } };
  });
  return { schemaVersion: 'live-view-1', snapshot: { schemaVersion: 'live-snapshot-1', round_id: roundId, classification: 'exhibition',
    tick: state.tick, sequence, status: state.tick === 120 ? 'completed' : 'running', configuration_hash: 'a'.repeat(64),
    control_state: state.control, control_revision: state.revision, snapshot: { policies } },
    events: { high_water: sequence, events }, vote_window: { schemaVersion: 'live-vote-window-1', round_id: roundId, window_index: 0,
      status: windowStatus, paused, deadline_ms: open && !paused ? state.deadline : null, remaining_ms: open ? Math.max(1, Math.min(20_000, state.deadline - now)) : 0,
      counts: { bus: 0, rain: 0, 'supplier-delay': 0 }, eligible_options: open && !paused ? ['bus', 'rain', 'supplier-delay'] : [] },
    vote_result: null, server_time_ms: now };
}
async function fixture(page: Page, state = publicState()) {
  const errors: string[] = [], forbidden: string[] = [], reads: number[] = [], submissions: Array<{ requestId: string; optionId: Option }> = [];
  let session = false, receipt: Receipt | null = null, loseNext = false, hideReceipt = false, rejectNext: number | null = null, holdGate: Promise<void> | null = null;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/admin/') || /worker|api\.zoom|typesafe/.test(url.pathname + url.hostname)) forbidden.push(request.url());
  });
  await page.route('**/api/live/rounds/**', async route => {
    const request = route.request(), url = new URL(request.url());
    expect(request.method()).toBe('GET');
    const after = Number(url.searchParams.get('after') ?? 0), limit = Number(url.searchParams.get('limit') ?? 100);
    reads.push(after);
    if (state.disconnected) return route.abort('internetdisconnected');
    if (state.unavailable) return route.fulfill({ status: 404, json: { error: 'round-not-found' } });
    const body = envelope(state, after, limit);
    if (state.malformedOnce) { state.malformedOnce = false; body.events.events = [{ round_id: roundId, sequence: after + 2, tick: after + 1, event_type: 'tick-committed', snapshot: body.snapshot.snapshot }]; }
    return route.fulfill({ status: 200, json: body });
  });
  await page.route('**/api/votes', async route => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON();
    if (body.action === 'session') {
      session = true;
      return route.fulfill({ status: 200, json: { window: envelope(state, 0, 100).vote_window } });
    }
    if (!session) return route.fulfill({ status: 401, json: { error: 'session-required' } });
    if (body.action === 'status') return route.fulfill({ status: 200, json: { window: envelope(state, 0, 100).vote_window, receipt: hideReceipt ? null : receipt, result: null } });
    expect(body.action).toBe('submit');
    expect(Object.keys(body).sort()).toEqual(['action', 'optionId', 'requestId', 'roundId']);
    expect(body.roundId).toBe(roundId);
    submissions.push({ requestId: body.requestId, optionId: body.optionId });
    if (holdGate) { const gate = holdGate; holdGate = null; await gate; }
    if (rejectNext !== null) { const status = rejectNext; rejectNext = null; return route.fulfill({ status, json: { error: status === 429 ? 'vote-rate-limited' : 'vote-conflict' } }); }
    const replayed = receipt?.request_id === body.requestId;
    receipt = { schemaVersion: 'live-vote-receipt-1', round_id: roundId, window_index: 0, request_id: body.requestId,
      option_id: body.optionId, accepted_at_ms: Date.now(), replayed };
    if (loseNext) { loseNext = false; hideReceipt = true; return route.abort('failed'); }
    hideReceipt = false;
    return route.fulfill({ status: 200, json: { receipt } });
  });
  return { state, reads, submissions, errors, forbidden, holdNext: () => { let release!: () => void; holdGate = new Promise<void>(resolve => { release = resolve; }); return release; }, loseNext: () => { loseNext = true; }, rejectNext: (status: number) => { rejectNext = status; }, expireSession: () => { session = false; } };
}
async function connected(page: Page) {
  await expect(page.getByRole('heading', { name: /live round/i })).toBeVisible();
  await expect(page.getByText(/connected/i, { exact: true })).toBeVisible();
}
async function join(page: Page) { await page.getByRole('button', { name: /join voting/i }).click(); }
async function choose(page: Page, label: string) { await page.getByRole('radio', { name: new RegExp(label, 'i') }).check(); }

// Browser fixtures model public responses only. They never start a round or call providers.
test('two viewers share committed state and public reads never invoke worker/operator APIs', async ({ page, context }) => {
  const state = publicState(), first = await fixture(page, state), secondPage = await context.newPage(), second = await fixture(secondPage, state);
  await Promise.all([page.goto(livePath), secondPage.goto(livePath)]);
  await Promise.all([connected(page), connected(secondPage)]);
  await expect(page.getByText(/tick 30/i).first()).toBeVisible();
  await expect(secondPage.getByText(/tick 30/i).first()).toBeVisible();
  state.tick = 31;
  await expect(page.getByText(/tick 31/i).first()).toBeVisible();
  await expect(secondPage.getByText(/tick 31/i).first()).toBeVisible();
  expect(first.reads.length).toBeGreaterThan(1); expect(second.reads.length).toBeGreaterThan(1);
  expect(first.forbidden.concat(second.forbidden)).toEqual([]); expect(first.errors.concat(second.errors)).toEqual([]);
});

test('pause is distinct from disconnection and reconnect keeps the last committed values', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(livePath); await connected(page);
  data.state.control = 'paused'; data.state.revision++;
  await expect(page.getByRole('heading', { name: 'Paused by operator', exact: true })).toBeVisible();
  await expect(page.getByText(/tick 30/i).first()).toBeVisible();
  data.state.disconnected = true;
  await expect(page.getByText(/connection lost/i, { exact: true })).toBeVisible();
  await expect(page.getByText(/tick 30/i).first()).toBeVisible();
  data.state.disconnected = false; data.state.control = 'active'; data.state.revision++;
  await page.getByRole('button', { name: /reconnect/i }).click(); await connected(page);
  expect(data.errors).toEqual([]);
});

test('a malformed cursor page is rejected, resynchronized, and never duplicates committed history', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(livePath); await connected(page);
  data.state.malformedOnce = true;
  await expect(page.getByText(/connection lost/i, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /reconnect/i }).click(); await connected(page);
  expect(data.reads.filter(value => value === 0).length).toBeGreaterThan(1);
  const ledger = page.getByRole('region', { name: 'Service ledger' });
  await expect(ledger.getByRole('listitem')).toHaveCount(12);
  const ticks = await ledger.getByRole('listitem').allTextContents();
  expect(new Set(ticks).size).toBe(ticks.length);
  expect(data.errors).toEqual([]); expect(data.forbidden).toEqual([]);
});

test('votes are acknowledged before acceptance and a changed selection gets a new request identity', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(livePath); await connected(page); await join(page);
  await choose(page, 'Bus arrival');
  const acknowledge = data.holdNext();
  await page.getByRole('button', { name: /submit vote/i }).click();
  await expect.poll(() => data.submissions.length).toBe(1);
  await expect(page.getByText(/^Vote accepted:/)).toHaveCount(0);
  acknowledge();
  await expect(page.getByText(/accepted/i).first()).toBeVisible();
  await choose(page, 'Afternoon rain');
  await page.getByRole('button', { name: /change vote|submit vote/i }).click();
  await expect.poll(() => data.submissions.length).toBe(2);
  expect(data.submissions[0]!.requestId).not.toBe(data.submissions[1]!.requestId);
  expect(data.submissions.map(value => value.optionId)).toEqual(['bus', 'rain']);
  expect(data.errors).toEqual([]);
});

test('an uncertain submission is never resent automatically and manual retry uses the same identity', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(livePath); await connected(page); await join(page); await choose(page, 'Bus arrival');
  data.loseNext(); await page.getByRole('button', { name: /submit vote/i }).click();
  const retry = page.getByRole('button', { name: /retry same vote/i });
  await expect(retry).toBeVisible();
  await page.waitForTimeout(2300);
  expect(data.submissions).toHaveLength(1);
  await retry.click();
  await expect(page.getByText(/accepted/i).first()).toBeVisible();
  expect(data.submissions).toHaveLength(2); expect(data.submissions[1]).toEqual(data.submissions[0]);
  expect(data.errors).toEqual([]);
});

test('rate rejection is explicit and an expired session requires rejoining rather than silent resubmission', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(livePath); await connected(page); await join(page); await choose(page, 'Afternoon rain');
  data.rejectNext(429); await page.getByRole('button', { name: /submit vote/i }).click();
  await expect(page.getByText(/limit|too many|too quickly/i).first()).toBeVisible();
  expect(data.submissions).toHaveLength(1);
  data.expireSession();
  await page.getByRole('button', { name: /submit vote/i }).click();
  await expect(page.getByRole('button', { name: /leave unconfirmed vote/i })).toBeVisible();
  expect(data.submissions).toHaveLength(1);
  await page.getByRole('button', { name: /leave unconfirmed vote/i }).click();
  await expect(page.getByRole('button', { name: /join voting/i })).toBeVisible();
  await join(page);
  expect(data.submissions).toHaveLength(1);
  expect(data.errors).toEqual([]);
});

test('an expired voting window disables submission without discarding the live round', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(livePath); await connected(page); await join(page); await choose(page, 'Bus arrival');
  data.state.deadline = Date.now() - 1;
  await expect(page.getByRole('button', { name: /submit vote/i })).toBeDisabled();
  await connected(page);
  expect(data.submissions).toHaveLength(0); expect(data.errors).toEqual([]);
});

test('a withdrawn round clears its old values and offers the offline fallback', async ({ page }) => {
  const data = await fixture(page);
  await page.goto(livePath); await connected(page);
  data.state.unavailable = true;
  await expect(page.getByText(/unavailable|not found|not available/i).first()).toBeVisible();
  await expect(page.getByText(/tick 30/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /offline/i }).first()).toBeVisible();
  expect(data.errors).toEqual([]);
});

test('join validation and keyboard voting remain available at zoom/mobile sizes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'reference', 'One batched visual inspection covers desktop, zoom and mobile.');
  const data = await fixture(page);
  await page.goto('/live');
  await page.getByRole('textbox').fill(roundId);
  await page.getByRole('button', { name: /watch|join|open/i }).click();
  await expect(page).toHaveURL(new RegExp(`${roundId}$`)); await connected(page);
  await join(page);
  const radio = page.getByRole('radio', { name: /Bus arrival/i });
  await expect(radio).toBeEnabled();
  await radio.focus(); await page.keyboard.press('Space'); await expect(radio).toBeChecked();
  mkdirSync('results/p5-g-viewer', { recursive: true });
  for (const [name, width, height] of [['desktop', 1920, 1080], ['zoom', 683, 384], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('button', { name: /submit vote/i })).toBeVisible();
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
    if (width < 1000) {
      const voting = await page.getByRole('heading', { name: 'Change the lunch rush' }).boundingBox();
      const ledger = await page.getByRole('heading', { name: 'Service ledger' }).boundingBox();
      expect(voting!.y).toBeLessThan(ledger!.y);
    }
    await page.screenshot({ path: `results/p5-g-viewer/${name}.png`, fullPage: true });
  }
  expect(data.errors).toEqual([]);
});
