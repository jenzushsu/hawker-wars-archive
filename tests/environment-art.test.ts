import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_LAYERS, ENVIRONMENT_LAYOUT, ENVIRONMENT_PALETTE, ENVIRONMENT_SIZE, environmentFrameName, environmentRects } from '../packages/art/src/environment.js';
import { checkEnvironmentAssets, createEnvironmentAssets, exportEnvironmentAssets, rasterEnvironment } from '../scripts/export-environment.js';

const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function pixel(rgba: Uint8Array, x: number, y: number, width = 480): number[] { return [...rgba.subarray((y * width + x) * 4, (y * width + x + 1) * 4)]; }
function decodePng(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes), chunks: Buffer[] = [];
  expect([...buffer.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  let width = 0, height = 0;
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8), data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0]); }
    if (type === 'IDAT') chunks.push(data);
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(chunks)), rgba = new Uint8Array(width * height * 4);
  expect(rows.length).toBe((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { expect(rows[y * (width * 4 + 1)]).toBe(0); rgba.set(rows.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4); }
  return { width, height, rgba };
}

describe('original environment source and occlusion contract', () => {
  it('preserves the logical canvas, original anchors and immutable clipped integer commands', () => {
    expect(ENVIRONMENT_SIZE).toEqual({ width: 480, height: 240 });
    expect(ENVIRONMENT_LAYOUT.stallOrigins).toEqual([20, 176, 332]);
    expect(ENVIRONMENT_LAYOUT.hawkerAnchors).toEqual([{ x: 78, y: 112 }, { x: 234, y: 112 }, { x: 390, y: 112 }]);
    expect(ENVIRONMENT_LAYOUT.seatedCustomerAnchors).toEqual([{ x: 55, feetY: 207, variant: 1 }, { x: 222, feetY: 204, variant: 5 }, { x: 405, feetY: 209, variant: 3 }]);
    expect(Object.isFrozen(ENVIRONMENT_PALETTE)).toBe(true);
    for (const layer of ENVIRONMENT_LAYERS) {
      const commands = environmentRects(layer);
      expect(Object.isFrozen(commands)).toBe(true); expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(Object.isFrozen(command)).toBe(true);
        expect([command.x, command.y, command.w, command.h].every(Number.isInteger)).toBe(true);
        expect(command.x).toBeGreaterThanOrEqual(0); expect(command.y).toBeGreaterThanOrEqual(0);
        expect(command.x + command.w).toBeLessThanOrEqual(480); expect(command.y + command.h).toBeLessThanOrEqual(240);
        expect(command.alpha).toBeGreaterThan(0); expect(command.alpha).toBeLessThanOrEqual(1);
      }
    }
    expect(() => environmentFrameName('people' as 'background')).toThrow();
    expect(() => Object.assign(ENVIRONMENT_LAYOUT.hawkerAnchors[0]!, { x: 0 })).toThrow();
  });
  it('keeps the back scene opaque while counter and furniture layers preserve transparent sight lines', () => {
    const background = rasterEnvironment('background'), counters = rasterEnvironment('counters'), foreground = rasterEnvironment('foreground');
    expect([...background.filter((_, index) => index % 4 === 3)].every(alpha => alpha === 255)).toBe(true);
    // Original authored steel counter top and the translucent one-row shadow below it.
    expect(pixel(counters, 16, 104)).toEqual([225, 230, 210, 255]);
    expect(pixel(counters, 18, 136)[3]).toBe(204);
    for (const [x, y] of [[0, 0], [78, 90], [160, 120], [78, 150], [240, 230]]) expect(pixel(counters, x!, y!)[3]).toBe(0);
    // Foreground no longer bakes the three seated customers' heads into the image.
    for (const [x, y] of [[55, 179], [222, 176], [405, 181], [240, 150]]) expect(pixel(foreground, x!, y!)[3]).toBe(0);
    expect(pixel(foreground, 77, 202)).toEqual([246, 236, 205, 255]);
    expect(pixel(foreground, 100, 210)[3]).toBe(179);
  });
  it('exports three full-scene frames without overlap, trimming, rotation or origin drift', () => {
    const assets = createEnvironmentAssets();
    expect(assets.width).toBe(488); expect(assets.height).toBe(744);
    expect(Math.max(assets.width, assets.height)).toBeLessThanOrEqual(2048);
    expect(Object.keys(assets.atlas.frames)).toEqual(ENVIRONMENT_LAYERS.map(environmentFrameName));
    for (const [index, layer] of ENVIRONMENT_LAYERS.entries()) {
      const entry = assets.atlas.frames[environmentFrameName(layer)]!;
      expect(entry).toMatchObject({ rotated: false, trimmed: false, sourceSize: { w: 480, h: 240 }, spriteSourceSize: { x: 0, y: 0, w: 480, h: 240 }, pivot: { x: 0, y: 0 } });
      const { x, y, w, h } = entry.frame;
      expect(x).toBe(4); expect(y).toBe(index * 248 + 4); expect(w).toBe(480); expect(h).toBe(240);
      // Sample whole source borders plus all extrusion rows/columns independently of the exporter.
      const source = assets.layers[layer];
      for (let dy = -2; dy < h + 2; dy++) for (const dx of [-2, -1, 0, 479, 480, 481]) {
        expect(pixel(assets.rgba, x + dx, y + dy, assets.width)).toEqual(pixel(source, Math.max(0, Math.min(479, dx)), Math.max(0, Math.min(239, dy))));
      }
      for (let dx = -2; dx < w + 2; dx++) for (const dy of [-2, -1, 0, 239, 240, 241]) {
        expect(pixel(assets.rgba, x + dx, y + dy, assets.width)).toEqual(pixel(source, Math.max(0, Math.min(479, dx)), Math.max(0, Math.min(239, dy))));
      }
      // Two untouched transparent padding pixels isolate the extruded frame.
      for (let yy = index * 248; yy < (index + 1) * 248; yy++) for (const xx of [0, 1, 486, 487]) expect(pixel(assets.rgba, xx, yy, assets.width)[3]).toBe(0);
      for (const yy of [index * 248, index * 248 + 1, index * 248 + 246, index * 248 + 247]) for (let xx = 0; xx < 488; xx++) expect(pixel(assets.rgba, xx, yy, assets.width)[3]).toBe(0);
    }
    expect(assets.manifest.includesPeople).toBe(false);
    expect(assets.manifest.drawOrder.indexOf('counters')).toBeGreaterThan(assets.manifest.drawOrder.indexOf('hawker-sprites'));
    expect(assets.manifest.drawOrder.indexOf('foreground')).toBeGreaterThan(assets.manifest.drawOrder.indexOf('seated-customer-sprites'));
  });
  it('produces deterministic PNGs with parseable RGBA pixels and a four-panel contact sheet', () => {
    const one = createEnvironmentAssets(), two = createEnvironmentAssets();
    expect(one.atlasJson).toBe(two.atlasJson); expect(one.layersJson).toBe(two.layersJson);
    expect(digest(one.atlasPng)).toBe(digest(two.atlasPng)); expect(digest(one.contactSheetPng)).toBe(digest(two.contactSheetPng));
    expect(decodePng(one.atlasPng)).toEqual({ width: one.width, height: one.height, rgba: one.rgba });
    const sheet = decodePng(one.contactSheetPng);
    expect(sheet.width).toBe(960); expect(sheet.height).toBe(480);
    expect([...sheet.rgba.filter((_, index) => index % 4 === 3)].every(alpha => alpha === 255)).toBe(true);
  });
  it('keeps runtime/review artifacts and provenance in sync with editable source', async () => {
    const assets = createEnvironmentAssets();
    for (const directory of ['assets/atlases', 'apps/web/public/art']) {
      expect(await readFile(`${directory}/environment.png`)).toEqual(assets.atlasPng);
      expect(await readFile(`${directory}/environment.json`, 'utf8')).toBe(assets.atlasJson);
      expect(await readFile(`${directory}/environment-layers.json`, 'utf8')).toBe(assets.layersJson);
      expect(await readFile(`${directory}/environment-contact-sheet.png`)).toEqual(assets.contactSheetPng);
      const source = JSON.parse(await readFile(`${directory}/environment-source.json`, 'utf8')) as { sourceSha256: string; atlasSha256: string; includesPeople: boolean; nativeAsepriteSource: boolean };
      expect(source.sourceSha256).toBe(digest(await readFile('packages/art/src/environment.ts')));
      expect(source.atlasSha256).toBe(digest(assets.atlasPng)); expect(source.includesPeople).toBe(false); expect(source.nativeAsepriteSource).toBe(false);
      expect(await readFile(`${directory}/environment-review.html`, 'utf8')).toContain('no people');
    }
  });
  it('check mode does not create, repair or overwrite missing/stale files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'environment-art-'));
    try {
      await mkdir(join(root, 'packages/art/src'), { recursive: true });
      await writeFile(join(root, 'packages/art/src/environment.ts'), await readFile('packages/art/src/environment.ts'));
      await expect(checkEnvironmentAssets(root)).rejects.toThrow('missing');
      await expect(stat(join(root, 'assets'))).rejects.toMatchObject({ code: 'ENOENT' });
      await exportEnvironmentAssets(root);
      const file = join(root, 'apps/web/public/art/environment.json'), before = await stat(file);
      await checkEnvironmentAssets(root); const after = await stat(file);
      expect(after.mtimeMs).toBe(before.mtimeMs); expect(after.ctimeMs).toBe(before.ctimeMs);
      await writeFile(file, 'stale original content');
      await expect(checkEnvironmentAssets(root)).rejects.toThrow('apps/web/public/art/environment.json');
      expect(await readFile(file, 'utf8')).toBe('stale original content');
      await rm(join(root, 'assets/atlases/environment.png'));
      await expect(checkEnvironmentAssets(root)).rejects.toThrow('assets/atlases/environment.png (missing)');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
