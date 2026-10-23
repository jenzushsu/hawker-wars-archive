import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { DemoData, DemoScenario, DemoTurn, DemoTerminal } from '../apps/web/lib/demo';

const demo = JSON.parse(readFileSync(resolve('apps/web/public/demo.json'), 'utf8')) as DemoData;
const host = (page: Page) => page.locator('[data-arena-state="ready"]');
interface Pose {
  role: 'queue' | 'receive' | 'depart' | 'eat';
  slot: number;
  clip: 'walk' | 'wait' | 'impatient' | 'receive' | 'eat' | 'depart';
  direction: 'up' | 'left' | 'right' | 'down';
  frame: number;
  offsetX: number;
  offsetY: number;
}
interface Atlas {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: { image: string; size: { w: number; h: number } };
}

async function openArena(page: Page) {
  await page.goto('/');
  await expect(host(page)).toBeVisible();
  await expect(host(page)).toHaveAttribute('data-environment-ready', 'true');
  await expect(host(page)).toHaveAttribute('data-customer-poses', /^\[/);
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
  return JSON.parse((await host(page).getAttribute('data-customer-poses'))!);
}
async function assertCommittedActivity(page: Page, scenario: DemoScenario, turn: DemoTurn | DemoTerminal) {
  const previous = turn.tick === 0 ? { served: 0, abandoned: 0 } : scenario.turns[turn.tick - 1]!.rulesBaseline;
  expect(turn.customerActivity.received).toBe(turn.rulesBaseline.served - previous.served);
  expect(turn.customerActivity.departed).toBe(turn.rulesBaseline.abandoned - previous.abandoned);
  await expect(host(page)).toHaveAttribute('data-received-count', String(turn.customerActivity.received));
  await expect(host(page)).toHaveAttribute('data-departed-count', String(turn.customerActivity.departed));
  await expect.poll(async () => (await poses(page)).filter(pose => pose.role === 'queue').map(pose => pose.clip))
    .toEqual(turn.customerActivity.queuePoses);
  const actual = await poses(page);
  const queue = actual.filter(pose => pose.role === 'queue');
  expect(queue.map(pose => pose.slot)).toEqual(turn.customerActivity.queuePoses.map((_, index) => index));
  expect(queue).toHaveLength(Math.min(3, turn.rulesBaseline.queueCount));
  expect(queue.every(pose => pose.direction === 'up')).toBe(true);
  for (const [role, present, direction] of [
    ['receive', turn.customerActivity.received > 0, 'left'],
    ['depart', turn.customerActivity.departed > 0, 'right'],
    ['eat', turn.rulesBaseline.served > 0, 'down'],
  ] as const) {
    const rolePoses = actual.filter(pose => pose.role === role);
    expect(rolePoses).toHaveLength(present ? 1 : 0);
    if (present) expect(rolePoses[0]).toMatchObject({ slot: 0, clip: role, direction });
  }
  expect(actual.every(pose => pose.frame === 0)).toBe(true);
}

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const forbidden: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if ((['http:', 'https:'].includes(url.protocol) && url.origin !== origin) || !['GET', 'HEAD'].includes(request.method())) {
      forbidden.push(`${request.method()} ${request.url()}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  (page as Page & { customerEvidence?: { forbidden: string[]; errors: string[] } }).customerEvidence = { forbidden, errors };
});
test.afterEach(async ({ page }) => {
  const evidence = (page as Page & { customerEvidence?: { forbidden: string[]; errors: string[] } }).customerEvidence;
  expect(evidence?.forbidden, 'Customer rendering must stay read-only and local').toEqual([]);
  expect(evidence?.errors, 'Customer and environment atlases must render without uncaught errors').toEqual([]);
});

test('loads the customer and three-layer environment atlases with bounded decoded textures', async ({ page }) => {
  const responses = new Map<string, Awaited<ReturnType<Page['waitForResponse']>>>();
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (/\/art\/(customer|environment)\.(png|json)$/.test(path)) responses.set(path, response);
  });
  await openArena(page);
  for (const name of ['customer', 'environment']) {
    await expect.poll(() => responses.has(`/art/${name}.png`) && responses.has(`/art/${name}.json`)).toBe(true);
    const image = responses.get(`/art/${name}.png`)!, response = responses.get(`/art/${name}.json`)!;
    expect(image.ok()).toBe(true);
    expect(response.ok()).toBe(true);
    const atlas = await response.json() as Atlas;
    const png = await image.body();
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) }).toEqual(atlas.meta.size);
    expect(Math.max(atlas.meta.size.w, atlas.meta.size.h)).toBeLessThanOrEqual(2048);
    expect(Object.keys(atlas.frames)).toHaveLength(name === 'customer' ? 480 : 3);
    for (const [key, { frame }] of Object.entries(atlas.frames)) {
      expect([frame.x, frame.y, frame.w, frame.h].every(Number.isInteger), key).toBe(true);
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y).toBeGreaterThanOrEqual(0);
      expect(frame.x + frame.w).toBeLessThanOrEqual(atlas.meta.size.w);
      expect(frame.y + frame.h).toBeLessThanOrEqual(atlas.meta.size.h);
      expect({ w: frame.w, h: frame.h }).toEqual(name === 'customer' ? { w: 24, h: 32 } : { w: 480, h: 240 });
    }
    const dimensions = await page.evaluate(async path => {
      const image = new Image(); image.src = path; await image.decode();
      return { w: image.naturalWidth, h: image.naturalHeight };
    }, `/art/${name}.png`);
    expect(dimensions).toEqual(atlas.meta.size);
    if (name === 'environment') expect(Object.keys(atlas.frames).sort()).toEqual(['environment/background', 'environment/counters', 'environment/foreground']);
  }
});

test('reconciles visible customer roles with recorded queue, sale and departure evidence', async ({ page }, testInfo) => {
  await openArena(page);
  for (const scenario of demo.scenarios) {
    await page.getByRole('combobox', { name: 'Recorded scenario' }).selectOption(scenario.id);
    const selected = new Set([0, 120]);
    for (const clip of ['walk', 'wait', 'impatient'] as const) {
      const turn = scenario.turns.find(item => item.customerActivity.queuePoses.includes(clip));
      if (turn) selected.add(turn.tick);
    }
    const departure = scenario.turns.find(item => item.customerActivity.departed > 0);
    if (departure) selected.add(departure.tick);
    for (const tick of [...selected].sort((a, b) => a - b)) {
      const turn = tick === 120 ? scenario.terminal : scenario.turns[tick]!;
      await seek(page, tick);
      await assertCommittedActivity(page, scenario, turn);
      await expect(host(page)).toHaveAttribute('data-presentation-time', '0');
      if (scenario.id === 'clean' && ['reference', 'minimum'].includes(testInfo.project.name)) {
        const directory = resolve('results/p3-ui-review', testInfo.project.name, 'customers');
        mkdirSync(directory, { recursive: true });
        await page.locator('canvas').screenshot({ path: resolve(directory, `tick-${tick}.png`) });
      }
    }
  }
});

test('animates bounded arrivals and departures, freezes on pause and reconstructs them on seek', async ({ page }) => {
  await openArena(page);
  const clean = demo.scenarios[0];
  const turn = clean.turns.find(item => item.customerActivity.departed > 0 && item.customerActivity.queuePoses.includes('walk'))!;
  expect(turn).toBeTruthy();
  await seek(page, turn.tick);
  await assertCommittedActivity(page, clean, turn);
  await page.clock.install();
  const original = await poses(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(350);
  // Read one committed render snapshot; animation can advance between separate protocol calls.
  const { elapsed, animated } = await host(page).evaluate(element => ({
    elapsed: Number(element.getAttribute('data-presentation-time')),
    animated: JSON.parse(element.getAttribute('data-customer-poses')!) as Pose[],
  }));
  expect(elapsed).toBeGreaterThan(200);
  expect(animated.find(pose => pose.role === 'depart')!.offsetX).toBe(Math.round(Math.min(elapsed / 500, 1) * 12));
  expect(animated.find(pose => pose.role === 'queue' && pose.clip === 'walk')!.offsetY).toBeLessThan(8);
  expect(animated.find(pose => pose.role === 'receive')!.frame).toBe(Math.min(3, Math.floor(elapsed * 8 / 1000)));
  expect(animated.find(pose => pose.role === 'depart')!.frame).toBeGreaterThan(0);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue(String(turn.tick));
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await poses(page);
  await page.clock.runFor(400);
  expect(await poses(page)).toEqual(paused);
  await seek(page, 0); await page.clock.runFor(50);
  await seek(page, turn.tick); await page.clock.runFor(50);
  expect(await poses(page)).toEqual(original);
  await page.getByRole('combobox', { name: 'Recorded scenario' }).selectOption('rain');
  await page.clock.runFor(50);
  await assertCommittedActivity(page, demo.scenarios[2], demo.scenarios[2].turns[0]!);
});

test('suppresses customer movement with reduced motion while retaining recorded activity', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openArena(page);
  const clean = demo.scenarios[0];
  const turn = clean.turns.find(item => item.customerActivity.departed > 0 && item.customerActivity.queuePoses.includes('walk'))!;
  await seek(page, turn.tick);
  await page.clock.install();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(350);
  await assertCommittedActivity(page, clean, turn);
  expect((await poses(page)).every(pose => pose.frame === 0 && pose.offsetX === 0 && pose.offsetY === 0)).toBe(true);
  await expect(host(page)).toHaveAttribute('data-presentation-time', '0');
  await page.clock.runFor(500);
  await expect(page.getByRole('slider', { name: 'Replay tick' })).toHaveValue(String(turn.tick + 1));
  await assertCommittedActivity(page, clean, clean.turns[turn.tick + 1]!);
  expect((await poses(page)).every(pose => pose.frame === 0 && pose.offsetX === 0 && pose.offsetY === 0)).toBe(true);
});
