import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { DemoData } from '../apps/web/lib/demo';

const demo = JSON.parse(readFileSync(resolve('apps/web/public/demo.json'), 'utf8')) as DemoData;
const host = (page: Page) => page.locator('[data-arena-state="ready"]');

async function openArena(page: Page) {
  await page.goto('/');
  await expect(host(page)).toBeVisible();
  await expect(host(page)).toHaveAttribute('data-frame-name', /^hawker\/green\//);
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

async function presentation(page: Page) {
  return host(page).evaluate(element => ({
    clip: (element as HTMLElement).dataset.clip,
    frame: Number((element as HTMLElement).dataset.frame),
    name: (element as HTMLElement).dataset.frameName,
    elapsedMs: Number((element as HTMLElement).dataset.presentationTime),
  }));
}

// This suite exercises the real Phaser client and its atlas, never provider execution.
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const forbidden: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if ((['http:', 'https:'].includes(url.protocol) && url.origin !== origin)
      || !['GET', 'HEAD'].includes(request.method())) {
      forbidden.push(`${request.method()} ${request.url()}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  (page as Page & { g1Evidence?: { forbidden: string[]; errors: string[] } }).g1Evidence = { forbidden, errors };
});

test.afterEach(async ({ page }) => {
  const evidence = (page as Page & { g1Evidence?: { forbidden: string[]; errors: string[] } }).g1Evidence;
  if (!evidence) return;
  expect(evidence.errors, 'No uncaught errors in the live animation client').toEqual([]);
  expect(evidence.forbidden, 'Animation and inspection stay within the local read-only demo').toEqual([]);
});

test('loads the atlas and projects all six clips from recorded outcomes', async ({ page }, testInfo) => {
  const atlas = page.waitForResponse(response => new URL(response.url()).pathname === '/art/hawker.json');
  const texture = page.waitForResponse(response => new URL(response.url()).pathname === '/art/hawker.png');
  await openArena(page);
  expect((await atlas).ok()).toBe(true);
  expect((await texture).ok()).toBe(true);
  const cases = [
    { scenario: 'clean', tick: 0, clip: 'serve' },
    { scenario: 'clean', tick: 3, clip: 'prepare' },
    { scenario: 'clean', tick: 8, clip: 'waiting' },
    { scenario: 'clean', tick: 26, clip: 'idle' },
    { scenario: 'supplier-delay', tick: 68, clip: 'shortage' },
    { scenario: 'supplier-delay', tick: 120, clip: 'celebrate' },
  ];
  for (const item of cases) {
    await page.getByRole('combobox', { name: 'Recorded scenario' }).selectOption(item.scenario);
    await seek(page, item.tick);
    await expect(host(page)).toHaveAttribute('data-clip', item.clip);
    await expect(host(page)).toHaveAttribute('data-frame', '0');
    await expect(host(page)).toHaveAttribute('data-frame-name', `hawker/green/${item.clip}/0`);
    await expect(host(page)).toHaveAttribute('data-presentation-time', '0');
    if (['reference', 'minimum'].includes(testInfo.project.name)) {
      const directory = resolve('results/g1-ui-review', testInfo.project.name, 'clips');
      mkdirSync(directory, { recursive: true });
      await page.locator('canvas').screenshot({ path: resolve(directory, `${item.clip}.png`) });
    }
  }
  await expect(page.locator('canvas')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('canvas')).toHaveAttribute('role', 'presentation');
});

test('advances rendered frames while playing, freezes on pause and resets on seek and scenario', async ({ page }) => {
  await openArena(page);
  await page.clock.install();
  const original = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(350);
  const running = await presentation(page);
  expect(running.clip).toBe('serve');
  expect(running.elapsedMs).toBeGreaterThanOrEqual(200);
  expect(running.elapsedMs).toBeLessThan(800);
  expect(running.frame).toBe(Math.min(5, Math.floor(running.elapsedMs / 100)));
  expect(running.name).toBe(`hawker/green/serve/${running.frame}`);
  expect(await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(original);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('0');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await presentation(page);
  await page.clock.runFor(400);
  expect(await presentation(page)).toEqual(paused);
  await seek(page, 26);
  await page.clock.runFor(50);
  expect(await presentation(page)).toEqual({ clip: 'idle', frame: 0, name: 'hawker/green/idle/0', elapsedMs: 0 });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(300);
  expect((await presentation(page)).elapsedMs).toBeGreaterThan(0);
  await page.getByRole('combobox', { name: 'Recorded scenario' }).selectOption('bus');
  await page.clock.runFor(50);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('0');
  expect(await presentation(page)).toEqual({ clip: 'serve', frame: 0, name: 'hawker/green/serve/0', elapsedMs: 0 });
});

test('uses 800 ms recorded ticks and completes the non-looping terminal celebration without changing results', async ({ page }) => {
  await openArena(page);
  const clockStart = Date.UTC(2026, 9, 23);
  await page.clock.install({ time: clockStart });
  // Freeze before Play so click/expect latency cannot cross the 800 ms boundary.
  await page.clock.pauseAt(clockStart + 1000);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(750);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('0');
  await page.clock.runFor(100);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('1');
  expect((await presentation(page)).elapsedMs).toBeLessThan(100);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await seek(page, 119);
  await page.clock.runFor(50);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(850);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('120');
  await expect(host(page)).toHaveAttribute('data-clip', 'celebrate');
  await page.clock.runFor(750);
  await expect(host(page)).toHaveAttribute('data-frame', '7');
  await expect(page.getByRole('button', { name: 'Replay', exact: true })).toBeVisible();
  const terminal = await presentation(page);
  await page.clock.runFor(1600);
  expect(await presentation(page)).toEqual(terminal);
  const final = demo.scenarios[0].terminal.rulesBaseline;
  await expect(page.locator('.stall-label .profit').first()).toContainText((final.profitCents / 100).toFixed(2));
  await expect(page.locator('.venue')).toContainText('Service complete');
});

test('keeps reduced-motion atlas frames and presentation time stationary during playback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openArena(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(400);
  expect(await presentation(page)).toEqual({ clip: 'serve', frame: 0, name: 'hawker/green/serve/0', elapsedMs: 0 });
  await page.clock.runFor(2000);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue('3');
  expect(await presentation(page)).toEqual({ clip: 'prepare', frame: 0, name: 'hawker/green/prepare/0', elapsedMs: 0 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await seek(page, 120);
  await page.clock.runFor(100);
  expect(await presentation(page)).toEqual({ clip: 'celebrate', frame: 0, name: 'hawker/green/celebrate/0', elapsedMs: 0 });
});

test('exposes text alternatives and modal semantics in Chromium accessibility tree', async ({ page }, testInfo) => {
  await openArena(page);
  await page.getByRole('button', { name: 'Analytical', exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  const tree = async () => (await cdp.send('Accessibility.getFullAXTree')).nodes.filter(node => !node.ignored);
  const initial = await tree();
  for (const name of ['Inspect TypeSafe Jev', 'Inspect Zoom Decisions', 'Inspect Zoom Decisions Pro']) {
    const node = initial.find(item => item.role?.value === 'button' && item.name?.value === name);
    expect(node, `${name} is available without the decorative canvas`).toBeTruthy();
    expect(node?.description?.value).toMatch(/Provisional profit SGD.*Rules demo mirror.*waiting/);
  }
  expect(initial.some(node => node.role?.value === 'slider' && node.name?.value === 'Replay tick')).toBe(true);
  expect(initial.some(node => node.role?.value === 'table')).toBe(true);
  await page.getByRole('button', { name: 'Expand decision', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const modal = await tree();
  const dialogNode = modal.find(node => node.role?.value === 'dialog');
  expect(dialogNode?.name?.value).toMatch(/TypeSafe Jev.*decision/);
  expect(dialogNode?.properties?.find(property => property.name === 'modal')?.value.value).toBe(true);
  expect(modal.some(node => node.role?.value === 'button' && node.name?.value === 'Help')).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Expand decision', exact: true })).toBeFocused();
  const evidence = JSON.stringify({ initial, modal }, null, 2);
  const directory = resolve('results/g1-accessibility');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `${testInfo.project.name}.json`), evidence);
  await testInfo.attach('chromium-accessibility-evidence', { body: evidence, contentType: 'application/json' });
  await cdp.detach();
});
