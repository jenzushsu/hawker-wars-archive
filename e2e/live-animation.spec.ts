import { test, expect } from '@playwright/test';

const id = '11111111-1111-4111-8111-111111111111';
test('live customers walk, preserve the clock across polls, and freeze on pause or disconnect', async ({ page }) => {
  let control = 'active', revision = 0, disconnected = false;
  const policies = [{ policy_id: 'rules', cash_cents: 20000, profit_cents: 0, utility_points: 0, served: 0, abandoned: 0,
    activity: { queue: 1, queuePoses: ['walk'], received: 0, departed: 0, cooking: false, ready: 0, raw: 42, action: 'WAIT' } }];
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/live/rounds/**', route => {
    if (disconnected) return route.abort();
    const after = Number(new URL(route.request().url()).searchParams.get('after') ?? 0);
    return route.fulfill({ json: { schemaVersion: 'live-view-1', snapshot: {
      schemaVersion: 'live-snapshot-1', round_id: id, classification: 'exhibition', tick: 0, sequence: 1,
      status: 'running', configuration_hash: 'a'.repeat(64), control_state: control, control_revision: revision, snapshot: { policies },
    }, events: { high_water: 1, events: after ? [] : [{ round_id: id, sequence: 1, tick: 0, event_type: 'tick-committed', snapshot: { policies } }] },
    vote_window: null, vote_result: null, server_time_ms: Date.now() } });
  });
  await page.goto(`/live/${id}`);
  const arena = page.locator('.arena-canvas');
  await expect(arena).toHaveAttribute('data-arena-state', 'ready');
  await expect.poll(async () => Number(await arena.getAttribute('data-presentation-time'))).toBeGreaterThan(900);
  await expect.poll(async () => JSON.parse(await arena.getAttribute('data-customer-poses') ?? '[]')[0]?.clip).toBe('wait');
  await expect.poll(async () => Number(await arena.getAttribute('data-presentation-time'))).toBeGreaterThan(2300);
  control = 'paused'; revision++;
  await expect(page.getByText('Animation paused', { exact: false })).toBeVisible();
  const paused = await arena.getAttribute('data-presentation-time');
  await page.waitForTimeout(200);
  expect(await arena.getAttribute('data-presentation-time')).toBe(paused);
  control = 'active'; revision++;
  await expect(page.getByText('Live activity', { exact: false })).toBeVisible();
  await expect.poll(async () => Number(await arena.getAttribute('data-presentation-time'))).toBeGreaterThan(Number(paused));
  disconnected = true;
  await expect(page.getByText('Connection lost', { exact: true })).toBeVisible();
  const frozen = await arena.getAttribute('data-presentation-time');
  await page.waitForTimeout(200);
  expect(await arena.getAttribute('data-presentation-time')).toBe(frozen);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => JSON.parse(await arena.getAttribute('data-customer-poses') ?? '[]')[0]?.offsetY).toBe(0);
});
