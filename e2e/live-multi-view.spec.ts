import { test, expect } from '@playwright/test';

// Explicit protocol fixture only; this is not evidence of live model execution.
test('four-policy live projection shows distinct scores and selectable stall animation', async ({ page }) => {
  const id = '11111111-1111-4111-8111-111111111111';
  const ids = ['rules', 'jev', 'zoom', 'zoom-pro'];
  const names = ['Rules stall', 'Jev', 'Zoom', 'Zoom Pro'];
  const policies = ids.map((policy_id, index) => ({ policy_id, cash_cents: 20000 + index * 100, profit_cents: index * 100,
    utility_points: index, served: index, abandoned: 0,
    activity: { queue: index, queuePoses: Array(index).fill('wait'), received: 0, departed: 0, cooking: false, ready: 12, raw: 30, action: 'WAIT' } }));
  await page.route('**/api/live/rounds/**', route => route.fulfill({ json: { schemaVersion: 'live-view-1', snapshot: {
    schemaVersion: 'live-snapshot-1', round_id: id, classification: 'exhibition', tick: 0, sequence: 1,
    status: 'running', configuration_hash: 'a'.repeat(64), control_state: 'active', control_revision: 0, snapshot: { policies },
  }, events: { high_water: 1, events: new URL(route.request().url()).searchParams.get('after') === '1' ? [] : [{ round_id: id, sequence: 1, tick: 0, event_type: 'tick-committed', snapshot: { policies } }] }, vote_window: null, vote_result: null, server_time_ms: Date.now() } }));
  await page.goto(`/live/${id}`);
  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(5);
  for (const [index, name] of names.entries()) {
    await expect(table.getByRole('rowheader', { name, exact: true })).toBeVisible();
    await page.getByLabel('Watch stall').selectOption(ids[index]!);
    await expect(page.getByText(`${name} · ${index} queuing · Live activity`, { exact: true })).toBeVisible();
    await expect(page.locator('.arena-canvas')).toHaveAttribute('data-arena-state', 'ready');
  }
  await expect(page.getByRole('button', { name: 'Join voting', exact: true })).toHaveCount(0);
});
