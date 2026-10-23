import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { DemoData, DemoTurn, DemoTerminal } from '../apps/web/lib/demo';

const demo = JSON.parse(readFileSync(resolve('apps/web/public/demo.json'), 'utf8')) as DemoData;
const host = (page: Page) => page.locator('[data-arena-state="ready"]');
interface Pose { clip: string; frame: number }
interface Atlas {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: { image: string; size: { w: number; h: number } };
}
async function openArena(page: Page) {
  await page.goto('/');
  await expect(host(page)).toBeVisible();
  await expect(host(page)).toHaveAttribute('data-effects-ready', 'true');
  await expect(host(page)).toHaveAttribute('data-effect-poses', /^\[/);
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
async function poses(page: Page): Promise<Pose[]> {
  return JSON.parse((await host(page).getAttribute('data-effect-poses'))!);
}
function expectedClips(turn: DemoTurn | DemoTerminal, reducedMotion = false): string[] {
  if (turn.phase === 'closed') return [];
  const state = turn.rulesBaseline;
  return [
    ...(state.cookingPortions > 0 && !reducedMotion ? ['steam'] : []),
    ...(turn.customerActivity.received > 0 ? ['service'] : []),
    ...(state.queueCount > 0 && state.readyPortions === 0 && state.rawPortions === 0 ? ['shortage'] : []),
    ...(turn.effectActivity.delivered ? ['delivery'] : []),
    ...(['bus', 'rain', 'supplier-delay'] as const).filter(effect => state.effects.includes(effect)),
  ];
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
  (page as Page & { effectEvidence?: { forbidden: string[]; errors: string[] } }).effectEvidence = { forbidden, errors };
});
test.afterEach(async ({ page }) => {
  const evidence = (page as Page & { effectEvidence?: { forbidden: string[]; errors: string[] } }).effectEvidence;
  expect(evidence?.forbidden, 'Effects and load recovery must stay local and read-only').toEqual([]);
  expect(evidence?.errors, 'Effects and malformed data must not cause uncaught errors').toEqual([]);
});

test('loads bounded effects and UI atlases while keeping decorative icons out of accessible names', async ({ page }) => {
  await openArena(page);
  for (const name of ['effects', 'ui']) {
    const atlas = await page.evaluate(async name => {
      const response = await fetch(`/art/${name}.json`);
      if (!response.ok) throw new Error(`Missing ${name} metadata`);
      return response.json();
    }, name) as Atlas;
    expect(Object.keys(atlas.frames).length).toBeGreaterThan(0);
    expect(Math.max(atlas.meta.size.w, atlas.meta.size.h)).toBeLessThanOrEqual(2048);
    for (const [key, { frame }] of Object.entries(atlas.frames)) {
      expect([frame.x, frame.y, frame.w, frame.h].every(Number.isInteger), key).toBe(true);
      expect(frame.x).toBeGreaterThanOrEqual(0); expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.w).toBeGreaterThan(0); expect(frame.h).toBeGreaterThan(0);
      expect(frame.x + frame.w).toBeLessThanOrEqual(atlas.meta.size.w);
      expect(frame.y + frame.h).toBeLessThanOrEqual(atlas.meta.size.h);
      if (name === 'effects') expect({ w: frame.w, h: frame.h }).toEqual({ w: 32, h: 32 });
      else expect([16, 24]).toContain(frame.w);
    }
    const decoded = await page.evaluate(async name => {
      const image = new Image(); image.src = `/art/${name}.png`; await image.decode();
      return { w: image.naturalWidth, h: image.naturalHeight };
    }, name);
    expect(decoded).toEqual(atlas.meta.size);
    if (name === 'effects') expect(Object.keys(atlas.frames)).toHaveLength(25);
  }
  const icons = page.locator('.ui-icon');
  expect(await icons.count()).toBeGreaterThan(0);
  for (const icon of await icons.all()) await expect(icon).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vote preview', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show analysis', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect TypeSafe Jev', exact: true })).toHaveAccessibleDescription(/Rules demo mirror/);
});

test('projects only recorded service, delivery and scenario effects and clears settlement cues', async ({ page }, testInfo) => {
  await openArena(page);
  const covered = new Set<string>();
  for (const scenario of demo.scenarios) {
    await page.getByRole('combobox', { name: 'Recorded scenario' }).selectOption(scenario.id);
    const ticks = new Set([0, 120]);
    for (const clip of ['steam', 'service', 'shortage', 'delivery', 'bus', 'rain', 'supplier-delay']) {
      const turn = scenario.turns.find(turn => expectedClips(turn).includes(clip));
      if (turn) ticks.add(turn.tick);
    }
    const ordered = scenario.turns.find(turn => turn.rulesBaseline.action === 'RESTOCK' && !turn.effectActivity.delivered);
    if (ordered) ticks.add(ordered.tick);
    const captureTicks = new Map<string, number>();
    for (const cue of scenario.id === 'clean' ? ['delivery', 'service', 'shortage'] : [scenario.id]) {
      const turn = scenario.turns.find(turn => expectedClips(turn).includes(cue));
      if (turn) captureTicks.set(cue, turn.tick);
    }
    for (const tick of ticks) {
      const turn = tick === 120 ? scenario.terminal : scenario.turns[tick]!;
      await seek(page, tick);
      await expect.poll(async () => await poses(page)).toEqual(expectedClips(turn).map(clip => ({ clip, frame: 0 })));
      expectedClips(turn).forEach(clip => covered.add(clip));
      expect((await poses(page)).length).toBeLessThanOrEqual(7);
      if (['reference', 'minimum'].includes(testInfo.project.name)) {
        for (const [cue, captureTick] of captureTicks) {
          if (tick !== captureTick) continue;
          const directory = resolve('results/p3-effects-ui', testInfo.project.name);
          mkdirSync(directory, { recursive: true });
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: resolve(directory, `${cue}.png`), fullPage: true, animations: 'disabled' });
        }
      }
    }
  }
  for (const clip of ['steam', 'service', 'delivery', 'bus', 'rain', 'supplier-delay']) expect(covered.has(clip), clip).toBe(true);
});

test('animates committed effects, freezes on pause and resets on seek without a backlog', async ({ page }) => {
  await openArena(page);
  const turn = demo.scenarios[0].turns.find(turn => turn.effectActivity.delivered)!;
  expect(turn).toBeTruthy();
  await seek(page, turn.tick);
  await expect.poll(async () => (await poses(page)).find(pose => pose.clip === 'delivery')?.frame).toBe(0);
  const initial = await poses(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(350);
  expect((await poses(page)).find(pose => pose.clip === 'delivery')!.frame).toBeGreaterThan(0);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue(String(turn.tick));
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await poses(page);
  await page.clock.runFor(400);
  expect(await poses(page)).toEqual(paused);
  await seek(page, 0); await page.clock.runFor(50);
  await seek(page, turn.tick); await page.clock.runFor(50);
  expect(await poses(page)).toEqual(initial);
  await expect(host(page)).toHaveAttribute('data-presentation-time', '0');
});

test('suppresses steam and freezes effect frames under reduced motion while playback still advances', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openArena(page);
  const turn = demo.scenarios[0].turns.find(turn => turn.rulesBaseline.cookingPortions > 0 && turn.customerActivity.received > 0)!;
  expect(turn).toBeTruthy();
  await seek(page, turn.tick);
  await expect.poll(async () => await poses(page)).toEqual(expectedClips(turn, true).map(clip => ({ clip, frame: 0 })));
  await page.clock.install();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(350);
  expect(await poses(page)).toEqual(expectedClips(turn, true).map(clip => ({ clip, frame: 0 })));
  await expect(host(page)).toHaveAttribute('data-presentation-time', '0');
  await page.clock.runFor(500);
  const next = demo.scenarios[0].turns[turn.tick + 1]!;
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue(String(next.tick));
  expect(await poses(page)).toEqual(expectedClips(next, true).map(clip => ({ clip, frame: 0 })));
});

test('rejects malformed public records gracefully and recovers through reload', async ({ page }) => {
  const malformed = structuredClone(demo);
  malformed.scenarios[0].turns[0]!.rulesBaseline.profitCents = 'invalid' as unknown as number;
  let restored = false;
  await page.route('**/demo.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(restored ? demo : malformed) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The replay could not load.' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('No provider request has been made');
  await expect(page.locator('canvas')).toHaveCount(0);
  restored = true;
  await page.getByRole('button', { name: 'Reload demo' }).click();
  await expect(host(page)).toBeVisible();
  await expect(host(page)).toHaveAttribute('data-effects-ready', 'true');
  await expect(page.getByRole('button', { name: 'Inspect TypeSafe Jev', exact: true })).toBeVisible();
});

test('shows an explicit empty-recording state with a usable recovery control', async ({ page }) => {
  await page.route('**/demo.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...demo, scenarios: [] }) }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No recorded run is available.' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('There are no recorded decisions to display.');
  await expect(page.getByRole('button', { name: 'Reload demo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(0);
});
