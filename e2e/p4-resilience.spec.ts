import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { DemoData } from '../apps/web/lib/demo';

const demo = JSON.parse(readFileSync(resolve('apps/web/public/demo.json'), 'utf8')) as DemoData;
const clean = demo.scenarios.find(scenario => scenario.id === 'clean')!;
const money = (cents: number) => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 2 }).format(cents / 100);

async function seek(page: Page, tick: number) {
  const slider = page.getByRole('slider', { name: 'Replay tick' });
  if (tick === 0 || tick === 120) {
    await slider.focus();
    await slider.press(tick === 0 ? 'Home' : 'End');
  } else {
    await slider.evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value));
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, tick);
  }
  await expect(slider).toHaveValue(String(tick));
}

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const forbidden: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if ((['http:', 'https:'].includes(url.protocol) && url.origin !== origin) || !['GET', 'HEAD'].includes(request.method())) {
      forbidden.push(`${request.method()} ${request.url()}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  (page as Page & { resilienceEvidence?: { forbidden: string[]; errors: string[] } }).resilienceEvidence = { forbidden, errors };
});
test.afterEach(async ({ page }) => {
  const evidence = (page as Page & { resilienceEvidence?: { forbidden: string[]; errors: string[] } }).resilienceEvidence;
  expect(evidence?.forbidden, 'Recovery and keyboard controls must remain local and read-only').toEqual([]);
  expect(evidence?.errors, 'An unavailable renderer must not crash the accessible replay').toEqual([]);
});

test('retains authoritative DOM results, playback and inspection when the effects atlas fails', async ({ page }) => {
  let failedRequests = 0;
  await page.route('**/art/effects.png', route => {
    failedRequests++;
    return route.fulfill({ status: 404, contentType: 'image/png', body: '' });
  });
  await page.goto('/');
  const fallback = page.locator('[data-arena-state="unavailable"]');
  await expect(fallback).toBeVisible();
  await expect(fallback.getByRole('status')).toHaveText('The arena is unavailable. Scores and decisions remain available below.');
  expect(failedRequests).toBeGreaterThan(0);
  await expect(page.locator('[data-arena-state="ready"]')).toHaveCount(0);
  for (const competitor of demo.competitors) {
    await expect(page.getByRole('button', { name: `Inspect ${competitor.name}`, exact: true })).toBeVisible();
  }
  await expect(page.locator('.stall-label .profit').first()).toHaveText(`${money(clean.turns[0]!.rulesBaseline.profitCents)} Provisional profit SGD`);
  await page.clock.install();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(850);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('1');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await seek(page, 60);
  await page.getByRole('button', { name: 'Analytical', exact: true }).click();
  await expect(page.locator('.stall-label .profit').first()).toHaveText(`${money(clean.turns[60]!.rulesBaseline.profitCents)} Provisional profit SGD`);
  await expect(page.getByRole('row').filter({ hasText: 'Rules baseline' })).toContainText(money(clean.turns[60]!.rulesBaseline.profitCents));
  await page.getByRole('button', { name: 'Inspect Zoom Decisions Pro', exact: true }).click();
  const compact = page.getByRole('region', { name: 'Selected decision' });
  await expect(compact.getByRole('heading')).toHaveText('Zoom Decisions Pro · tick 60');
  const opener = compact.getByRole('button', { name: 'Expand decision', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Zoom Decisions Pro · decision 60', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Observation', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Outcome', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await seek(page, 120);
  await expect(page.locator('.stall-label .profit').first()).toHaveText(`${money(clean.terminal.rulesBaseline.profitCents)} Final profit SGD`);
  await expect(page.getByRole('button', { name: 'Replay', exact: true })).toBeVisible();
  await expect(fallback.getByRole('status')).toBeVisible();
});

test('leaves form-field and modifier keys untouched while unmodified shortcuts remain usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-arena-state="ready"]')).toBeVisible();
  await page.getByRole('button', { name: 'Analytical', exact: true }).click();
  await seek(page, 12);
  await page.getByRole('button', { name: 'Inspect TypeSafe Jev', exact: true }).click();
  await seek(page, 40);
  const scenario = page.getByRole('combobox', { name: 'Recorded scenario' });
  const slider = page.getByRole('slider', { name: 'Replay tick' });
  const compact = page.getByRole('region', { name: 'Selected decision' });
  const rail = page.getByRole('complementary', { name: 'Local vote preview' });
  async function unchanged() {
    await expect(page.getByRole('button', { name: 'Analytical', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(rail).not.toBeVisible();
    await expect(compact.getByRole('heading')).toHaveText('TypeSafe Jev · tick 12');
    await expect(slider).toHaveValue('40');
    await expect(scenario).toHaveValue('clean');
  }
  for (const field of [scenario, slider]) {
    await field.focus();
    for (const key of ['c', 'v', '3']) {
      await page.keyboard.press(key);
      await unchanged();
    }
  }
  // Read the final defaultPrevented state after every application key handler has run.
  await page.evaluate(() => {
    document.documentElement.dataset.p4ModifierEvents = '[]';
    window.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && ['c', 'v', '3'].includes(event.key)) {
        queueMicrotask(() => {
          const element = document.documentElement;
          const events = JSON.parse(element.dataset.p4ModifierEvents!) as { key: string; prevented: boolean }[];
          events.push({ key: event.key, prevented: event.defaultPrevented });
          element.dataset.p4ModifierEvents = JSON.stringify(events);
        });
      }
    });
  });
  await page.getByRole('button', { name: 'Help', exact: true }).focus();
  for (const key of ['Control+c', 'Meta+c', 'Control+v', 'Meta+v', 'Control+3', 'Meta+3']) {
    await page.keyboard.press(key);
    await unchanged();
  }
  const modifierEvents = await page.evaluate(() => JSON.parse(document.documentElement.dataset.p4ModifierEvents!) as { key: string; prevented: boolean }[]);
  expect(modifierEvents).toHaveLength(6);
  expect(modifierEvents.every(event => !event.prevented), 'Application shortcuts must not consume browser modifier keys').toBe(true);
  await page.keyboard.press('c');
  await expect(page.getByRole('button', { name: 'Cinematic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('v');
  await expect(rail).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rail).not.toBeVisible();
  await page.keyboard.press('3');
  await expect(compact.getByRole('heading')).toHaveText('Zoom Decisions Pro · tick 40');
});
