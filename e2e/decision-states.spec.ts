import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const selector = (page: Page) => page.getByRole('combobox', { name: 'Decision state', exact: true });
const value = (page: Page, label: string) => page.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]');
async function openExamples(page: Page) {
  await page.goto('/decision-states');
  await expect(page.getByRole('heading', { name: 'Decision state examples', exact: true })).toBeVisible();
  await expect(page.getByText('Presentation examples only. No provider call or recorded result.', { exact: true })).toBeVisible();
}
async function seek(page: Page, tick: number) {
  const slider = page.getByRole('slider', { name: 'Replay tick' });
  await slider.evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, tick);
  await expect(slider).toHaveValue(String(tick));
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const forbidden: string[] = [], errors: string[] = [];
  for (const existing of context.pages()) existing.on('pageerror', error => errors.push(error.message));
  context.on('page', opened => opened.on('pageerror', error => errors.push(error.message)));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if ((['http:', 'https:'].includes(url.protocol) && url.origin !== origin) || !['GET', 'HEAD'].includes(request.method())) {
      forbidden.push(`${request.method()} ${request.url()}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  (page as Page & { stateEvidence?: { forbidden: string[]; errors: string[] } }).stateEvidence = { forbidden, errors };
});
test.afterEach(async ({ page }) => {
  const evidence = (page as Page & { stateEvidence?: { forbidden: string[]; errors: string[] } }).stateEvidence;
  expect(evidence?.forbidden, 'Decision examples and linked tabs must remain local and read-only').toEqual([]);
  expect(evidence?.errors, 'Decision examples must not raise uncaught browser errors').toEqual([]);
});

test('selects all five examples with the keyboard and announces the selected state', async ({ page }) => {
  await openExamples(page);
  const control = selector(page);
  await control.focus();
  await control.press('Home');
  const labels = ['Pending', 'Invalid', 'Timeout', 'Fallback', 'Missing usage'];
  for (const [index, label] of labels.entries()) {
    if (index > 0) await control.press('ArrowDown');
    await expect(control).toBeFocused();
    await expect(control.locator('option:checked')).toHaveText(label);
    await expect(page.getByRole('heading', { name: `${label} decision`, exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText(`Showing ${label} example.`);
  }
  await control.press('Home');
  await expect(control).toHaveValue('pending');
  await control.press('End');
  await expect(control).toHaveValue('missing-usage');
});

test('opens examples from Help in a separate page without changing the paused replay', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('[data-arena-state="ready"]')).toBeVisible();
  await seek(page, 18);
  await page.getByRole('button', { name: 'Inspect Zoom Decisions Pro', exact: true }).click();
  await seek(page, 40);
  const heading = page.getByRole('region', { name: 'Selected decision' }).getByRole('heading');
  await expect(heading).toHaveText('Zoom Decisions Pro · tick 18');
  const profits = await page.locator('.stall-label .profit').allTextContents();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const link = page.getByRole('link', { name: 'Decision state examples (opens in new tab)', exact: true });
  await expect(link).toHaveAttribute('href', '/decision-states');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  const newPage = context.waitForEvent('page');
  await link.click();
  const examples = await newPage;
  await expect(examples).toHaveURL(/\/decision-states$/);
  await expect(examples.getByRole('heading', { name: 'Decision state examples', exact: true })).toBeVisible();
  await selector(examples).selectOption('fallback');
  await expect(examples.getByRole('status')).toHaveText('Showing Fallback example.');
  await examples.close();
  await page.bringToFront();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('40');
  await expect(heading).toHaveText('Zoom Decisions Pro · tick 18');
  expect(await page.locator('.stall-label .profit').allTextContents()).toEqual(profits);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Recorded scenario' })).toHaveValue('clean');
});

test('keeps pending, fallback and missing-usage examples readable across desktop and zoom-equivalent layouts', async ({ page }, testInfo) => {
  await openExamples(page);
  for (const state of ['pending', 'fallback', 'missing-usage']) {
    await selector(page).selectOption(state);
    const article = page.locator(`[data-decision-state="${state}"]`);
    await expect(article).toBeVisible();
    const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(bounds.scroll, 'Example detail text must reflow without page-level horizontal scrolling').toBeLessThanOrEqual(bounds.width + 1);
    for (const detail of await article.locator('dd').all()) {
      const box = await detail.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds.width + 1);
      expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Detail content must fit its readable column').toBe(true);
    }
    await selector(page).focus();
    await expect(selector(page)).toBeFocused();
    if (['reference', 'minimum'].includes(testInfo.project.name)) {
      const directory = resolve('results/p4-decision-states', testInfo.project.name);
      mkdirSync(directory, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(directory, `${state}.png`), fullPage: true, animations: 'disabled' });
    }
  }
});

test('distinguishes pending, rejection, timeout, fallback and missing usage without invented results', async ({ page }) => {
  await openExamples(page);
  await expect(selector(page).locator('option')).toHaveCount(5);
  const examples = [
    { id: 'pending', label: 'Pending', proposed: 'Not available', accepted: 'None', fallback: 'None', source: 'No action source', outcome: 'Pending — no committed outcome' },
    { id: 'invalid', label: 'Invalid', proposed: 'COOK', accepted: 'None', fallback: 'None', source: 'No action source', outcome: 'Pending — no committed outcome' },
    { id: 'timeout', label: 'Timeout', proposed: 'Not available', accepted: 'None', fallback: 'None', source: 'No action source', outcome: 'Pending — no committed outcome' },
    { id: 'fallback', label: 'Fallback', proposed: 'COOK', accepted: 'None', fallback: 'WAIT', source: 'Rules fallback (example)', outcome: 'Committed in this example' },
    { id: 'missing-usage', label: 'Missing usage', proposed: 'SERVE', accepted: 'SERVE', fallback: 'None', source: 'Model proposal (example)', outcome: 'Committed in this example' },
  ];
  for (const example of examples) {
    await selector(page).selectOption(example.id);
    const article = page.locator(`[data-decision-state="${example.id}"]`);
    await expect(article).toContainText('Example policy');
    await expect(page.getByRole('heading', { name: `${example.label} decision`, exact: true })).toBeVisible();
    await expect(value(page, 'Proposed action')).toHaveText(example.proposed);
    await expect(value(page, 'Accepted action')).toHaveText(example.accepted);
    await expect(value(page, 'Fallback action')).toHaveText(example.fallback);
    await expect(value(page, 'Decision source')).toHaveText(example.source);
    await expect(value(page, 'Outcome')).toContainText(example.outcome);
    await expect(value(page, 'Native usage')).toHaveText(/^Not available\s*No usage was supplied for this presentation example\.$/);
    await expect(value(page, 'Cost')).toHaveText(/^Unknown\s*A cost cannot be calculated without native usage\.$/);
    await expect(value(page, 'Explanation')).toHaveText(/^Not supplied\s*No model reasoning is included\.$/);
    await expect(article).not.toContainText(/TypeSafe Jev|Zoom Decisions|\bSGD\s*\d|\$\s*\d|\b\d+\s*(?:tokens|customers served)\b/);
    await expect(page.getByText('Presentation examples only. No provider call or recorded result.', { exact: true })).toBeVisible();
  }
});
