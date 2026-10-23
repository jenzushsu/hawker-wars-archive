import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { DemoData } from '../apps/web/lib/demo';

const demo = JSON.parse(readFileSync(resolve('apps/web/public/demo.json'), 'utf8')) as DemoData;
const compact = (page: Page) => page.getByRole('region', { name: 'Selected decision' });
async function openArena(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-arena-state="ready"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect TypeSafe Jev', exact: true })).toBeVisible();
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
async function analysis(page: Page) {
  await page.getByRole('button', { name: 'Analytical', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Match', exact: true })).toBeVisible();
}
async function inspector(page: Page) {
  await page.getByRole('button', { name: 'Inspect TypeSafe Jev', exact: true }).click();
  await page.getByRole('button', { name: 'Expand decision', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
async function mockClipboard(page: Page, fail = false) {
  await page.addInitScript(fail => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => {
        if (fail) throw new DOMException('Clipboard unavailable', 'NotAllowedError');
        (window as Window & { copiedDecision?: string }).copiedDecision = text;
      },
    } });
  }, fail);
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
  (page as Page & { p4Evidence?: { forbidden: string[]; errors: string[] } }).p4Evidence = { forbidden, errors };
});
test.afterEach(async ({ page }) => {
  const evidence = (page as Page & { p4Evidence?: { forbidden: string[]; errors: string[] } }).p4Evidence;
  expect(evidence?.forbidden, 'Spectator controls must remain local and read-only').toEqual([]);
  expect(evidence?.errors, 'Spectator controls must not raise uncaught browser errors').toEqual([]);
});

test('navigates analysis tabs with arrows, Home and End using one tab stop', async ({ page }) => {
  await openArena(page); await analysis(page);
  const match = page.getByRole('tab', { name: 'Match', exact: true });
  const decisions = page.getByRole('tab', { name: 'Decisions', exact: true });
  const benchmarks = page.getByRole('tab', { name: 'Benchmarks', exact: true });
  await match.focus();
  for (const [key, target] of [
    ['ArrowRight', decisions], ['ArrowRight', benchmarks], ['ArrowRight', match],
    ['ArrowLeft', benchmarks], ['Home', match], ['End', benchmarks],
  ] as const) {
    await page.keyboard.press(key);
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await expect(target).toHaveAttribute('tabindex', '0');
    for (const other of [match, decisions, benchmarks]) {
      if (other === target) continue;
      await expect(other).toHaveAttribute('aria-selected', 'false');
      await expect(other).toHaveAttribute('tabindex', '-1');
    }
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
  }
});

test('limits history to recorded playback and pins the filtered policy decision as playback advances', async ({ page }) => {
  await openArena(page); await seek(page, 20); await analysis(page);
  await page.getByRole('tab', { name: 'Decisions', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Decisions', exact: true });
  const filter = page.getByRole('combobox', { name: 'Decision policy', exact: true });
  await expect(filter.locator('option')).toHaveCount(3);
  for (const competitor of demo.competitors) {
    await filter.selectOption({ label: `${competitor.name} · rules demo mirror` });
    await expect(panel.getByRole('button', { name: /^Inspect .* decision at tick / })).toHaveCount(21);
    await expect(panel.getByRole('button', { name: `Inspect ${competitor.name} decision at tick 20`, exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: `Inspect ${competitor.name} decision at tick 21`, exact: true })).toHaveCount(0);
  }
  await panel.getByRole('button', { name: 'Inspect Zoom Decisions Pro decision at tick 12', exact: true }).click();
  await expect(compact(page).getByRole('heading')).toHaveText('Zoom Decisions Pro · tick 12');
  await page.clock.install();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(1700);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('22');
  await expect(compact(page).getByRole('heading')).toHaveText('Zoom Decisions Pro · tick 12');
  await expect(panel.getByRole('button', { name: /^Inspect .* decision at tick / })).toHaveCount(23);
  await expect(panel.getByRole('button', { name: 'Inspect Zoom Decisions Pro decision at tick 23', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Decision action', exact: true }).selectOption('COOK');
  const expected = demo.scenarios[0].turns.slice(0, 23).filter(turn => turn.rulesBaseline.action === 'COOK');
  await expect(panel.getByRole('button', { name: /^Inspect .* decision at tick / })).toHaveCount(expected.length);
  for (const turn of expected) await expect(panel.getByRole('button', { name: `Inspect Zoom Decisions Pro decision at tick ${turn.tick}`, exact: true })).toBeVisible();
  expect(demo.scenarios[0].turns[0]!.rulesBaseline.action).toBe('SERVE');
  await seek(page, 0);
  await page.getByRole('combobox', { name: 'Decision action', exact: true }).selectOption('PROMOTE');
  await expect(panel.getByRole('button', { name: /^Inspect .* decision at tick / })).toHaveCount(0);
  await expect(panel).toContainText('No PROMOTE decisions through tick 0.');
  await page.getByRole('combobox', { name: 'Decision action', exact: true }).selectOption('all');
  await expect(panel.getByRole('button', { name: /^Inspect .* decision at tick / })).toHaveCount(1);
  await seek(page, 22);
  await expect(panel.getByRole('button', { name: /^Inspect .* decision at tick / })).toHaveCount(23);
  await expect(compact(page).getByRole('heading')).toHaveText('Zoom Decisions Pro · tick 12');
});

test('retains analysis tab, filters and history scroll after collapse and mode changes', async ({ page }) => {
  await openArena(page); await seek(page, 100); await analysis(page);
  const decisions = page.getByRole('tab', { name: 'Decisions', exact: true });
  await decisions.click();
  const policy = page.getByRole('combobox', { name: 'Decision policy', exact: true });
  const action = page.getByRole('combobox', { name: 'Decision action', exact: true });
  await policy.selectOption({ label: 'Zoom Decisions · rules demo mirror' });
  await action.selectOption('WAIT');
  const scroll = page.locator('[data-analysis-scroll="decisions"]');
  const saved = await scroll.evaluate(element => {
    element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight);
    return element.scrollTop;
  });
  expect(saved, 'History must offer an internally scrollable list').toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Hide analysis', exact: true }).click();
  await page.getByRole('button', { name: 'Show analysis', exact: true }).click();
  await expect(decisions).toHaveAttribute('aria-selected', 'true');
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(saved);
  await page.getByRole('button', { name: 'Cinematic', exact: true }).click();
  await page.getByRole('button', { name: 'Analytical', exact: true }).click();
  await expect(decisions).toHaveAttribute('aria-selected', 'true');
  await expect(policy.locator('option:checked')).toHaveText('Zoom Decisions · rules demo mirror');
  await expect(action).toHaveValue('WAIT');
  expect(await scroll.evaluate(element => element.scrollTop)).toBe(saved);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('100');
});

test('states unavailable model benchmarks and exposes actual offline provenance', async ({ page }) => {
  await openArena(page); await analysis(page);
  await page.getByRole('tab', { name: 'Benchmarks', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Benchmarks', exact: true });
  await expect(panel).toContainText('Model benchmarks unavailable');
  for (const version of [demo.schemaVersion, demo.baselineVersion, demo.simulationVersion, demo.scorerVersion]) await expect(panel).toContainText(version);
  await expect(panel.getByRole('link')).toHaveAttribute('href', '/demo.json');
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('0');
  await page.getByRole('tab', { name: 'Match', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Rules baseline' })).toBeVisible();
});

test('copies the sanitized pinned decision with truthful inspector provenance', async ({ page }) => {
  await mockClipboard(page); await openArena(page); await seek(page, 18); await inspector(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  for (const version of [demo.schemaVersion, demo.baselineVersion, demo.simulationVersion, demo.scorerVersion]) await expect(dialog).toContainText(version);
  for (const label of ['Schema', 'Baseline', 'Simulation', 'Scorer', 'Wall time', 'Native usage', 'Canonical state hash']) await expect(dialog.getByText(label, { exact: true })).toBeVisible();
  await expect(dialog).toContainText('Not recorded in this offline replay');
  await dialog.getByRole('button', { name: 'Copy decision', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Decision copied.');
  const copied = await page.evaluate(() => (window as Window & { copiedDecision?: string }).copiedDecision);
  expect(copied).toBeTruthy();
  const payload = JSON.parse(copied!);
  expect(payload).toMatchObject({ schemaVersion: demo.schemaVersion, scenario: 'clean', tick: 18, decision: demo.scenarios[0].turns[18]!.stalls[0] });
  expect(copied).not.toMatch(/"(?:seed|schedule|requestId|authorization)"\s*:/i);
  await page.keyboard.press('Escape');
  await seek(page, 40);
  await page.getByRole('button', { name: 'Expand decision', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: () => new Promise<void>(resolve => {
        (window as Window & { completeCopy?: () => void }).completeCopy = resolve;
      }),
    } });
  });
  await dialog.getByRole('button', { name: 'Copy decision', exact: true }).click();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'TypeSafe Jev · decision 19', exact: true })).toBeVisible();
  await page.evaluate(() => (window as Window & { completeCopy?: () => void }).completeCopy!());
  await expect(dialog.getByRole('status')).not.toHaveText('Decision copied.');
});

test('reports clipboard denial and retains the decision download fallback', async ({ page }) => {
  await mockClipboard(page, true); await openArena(page); await inspector(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Copy decision', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Copy failed. Download this decision instead.');
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download decision', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('hawker-decision-clean-0.json');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy decision', exact: true })).toBeEnabled();
});

test('restores view defaults while preserving replay, pinned decision and local vote', async ({ page }) => {
  await openArena(page); await seek(page, 18);
  await page.getByRole('button', { name: 'Inspect Zoom Decisions Pro', exact: true }).click();
  await seek(page, 40); await analysis(page);
  await page.getByRole('button', { name: 'Vote preview', exact: true }).click();
  await page.getByRole('button', { name: /^Bus arrival Six extra customers/ }).click();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'Enable single-key shortcuts' }).uncheck();
  await dialog.getByRole('button', { name: 'Restore view defaults', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('View defaults restored. Replay and selections kept.');
  await expect(dialog.getByRole('checkbox', { name: 'Enable single-key shortcuts' })).toBeChecked();
  expect(await page.evaluate(() => [localStorage.getItem('hawker-view'), localStorage.getItem('hawker-hud'), localStorage.getItem('hawker-shortcuts')])).toEqual(['cinematic', 'collapsed', 'on']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Cinematic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Show analysis', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('40');
  await expect(page.getByRole('combobox', { name: 'Recorded scenario' })).toHaveValue('clean');
  if (!await page.getByRole('complementary', { name: 'Local vote preview' }).isVisible()) await page.getByRole('button', { name: 'Vote preview', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Local vote preview' })).toContainText('Bus arrival selected locally. No vote sent.');
  await page.getByRole('button', { name: 'Show analysis', exact: true }).click();
  await expect(compact(page).getByRole('heading')).toHaveText('Zoom Decisions Pro · tick 18');
});

test('captures crowded analysis tabs with all stall identities and controls available', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openArena(page); await seek(page, 60); await analysis(page);
  await page.getByRole('button', { name: 'Vote preview', exact: true }).click();
  for (const name of ['Match', 'Decisions', 'Benchmarks']) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
    for (const competitor of demo.competitors) await expect(page.getByRole('button', { name: `Inspect ${competitor.name}`, exact: true })).toBeVisible();
    const bounds = await page.evaluate(() => ({ available: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.available + 1);
    if (['reference', 'minimum'].includes(testInfo.project.name)) {
      if (name === 'Decisions') {
        const panel = page.getByRole('tabpanel', { name, exact: true });
        const newestRow = panel.getByRole('row').filter({ has: page.getByRole('button', { name: 'Inspect TypeSafe Jev decision at tick 60', exact: true }) });
        const [panelBounds, rowBounds] = await Promise.all([panel.boundingBox(), newestRow.boundingBox()]);
        expect(panelBounds).not.toBeNull(); expect(rowBounds).not.toBeNull();
        expect(rowBounds!.y, 'The newest recorded decision must begin inside the unscrolled panel').toBeGreaterThanOrEqual(panelBounds!.y);
        expect(rowBounds!.y + rowBounds!.height, 'The first complete decision row must fit without scrolling past filters and headings').toBeLessThanOrEqual(panelBounds!.y + panelBounds!.height + 1);
      }
      const directory = resolve('results/p4-controls', testInfo.project.name);
      mkdirSync(directory, { recursive: true });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: resolve(directory, `${name.toLowerCase()}-crowded.png`), fullPage: true, animations: 'disabled' });
    }
  }
});
