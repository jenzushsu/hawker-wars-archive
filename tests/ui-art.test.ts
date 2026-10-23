import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { UI_ATLAS_SIZE, UI_ICON_NAMES, UI_ICON_SIZES, UI_PALETTE, uiAtlasFrame, uiFrameName, uiRects } from '../packages/art/src/ui.js';
import { checkUiAssets, createUiAssets, exportUiAssets, rasterUi } from '../scripts/export-ui.js';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const pixel = (rgba: Uint8Array, width: number, x: number, y: number) => [...rgba.subarray((y * width + x) * 4, (y * width + x + 1) * 4)];
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

describe('original UI pictogram assets', () => {
  it('authors nine distinct silhouettes on immutable 16px and 24px integer grids', () => {
    expect(UI_ICON_NAMES).toEqual(['inventory', 'queue', 'time', 'latency', 'warning', 'validation', 'vote', 'sound', 'expand']);
    expect(UI_ICON_SIZES).toEqual([16, 24]); expect(Object.isFrozen(UI_PALETTE)).toBe(true);
    for (const size of UI_ICON_SIZES) {
      const hashes = new Set<string>();
      for (const name of UI_ICON_NAMES) {
        const commands = uiRects(name, size), rgba = rasterUi(name, size);
        expect(Object.isFrozen(commands)).toBe(true); expect(commands.length).toBeGreaterThan(0);
        for (const r of commands) {
          expect(Object.isFrozen(r)).toBe(true); expect([r.x, r.y, r.w, r.h].every(Number.isInteger)).toBe(true);
          expect(r.x).toBeGreaterThanOrEqual(1); expect(r.y).toBeGreaterThanOrEqual(1);
          expect(r.w).toBeGreaterThan(0); expect(r.h).toBeGreaterThan(0);
          expect(r.x + r.w).toBeLessThan(size); expect(r.y + r.h).toBeLessThan(size);
          expect(Object.values(UI_PALETTE)).toContain(r.color);
        }
        for (let i = 0; i < size; i++) for (const [x, y] of [[0, i], [size - 1, i], [i, 0], [i, size - 1]]) expect(pixel(rgba, size, x!, y!)[3]).toBe(0);
        const alphas = [...rgba.filter((_, i) => i % 4 === 3)];
        expect(alphas.every(alpha => alpha === 0 || alpha === 255)).toBe(true);
        expect(alphas.filter(alpha => alpha === 255).length).toBeGreaterThan(size);
        hashes.add(digest(rgba));
      }
      expect(hashes.size).toBe(9);
    }
    expect(() => uiFrameName('unknown' as 'inventory', 16)).toThrow();
    expect(() => uiAtlasFrame('inventory', 20 as 16)).toThrow();
    expect(() => uiRects('inventory', 32 as 16)).toThrow();
  });
  it('exports eighteen full frames with no overlap and exact transparent extrusion and padding', () => {
    const assets = createUiAssets();
    expect({ width: assets.width, height: assets.height }).toEqual(UI_ATLAS_SIZE);
    expect(Object.keys(assets.atlas.frames)).toHaveLength(18);
    for (const [row, size] of UI_ICON_SIZES.entries()) for (const [column, name] of UI_ICON_NAMES.entries()) {
      const entry = assets.atlas.frames[uiFrameName(name, size)]!, { x, y, w, h } = entry.frame;
      expect(entry).toMatchObject({ rotated: false, trimmed: false, sourceSize: { w: size, h: size }, spriteSourceSize: { x: 0, y: 0, w: size, h: size }, pivot: { x: 0.5, y: 0.5 } });
      expect(w).toBe(size); expect(h).toBe(size);
      expect(x).toBe(column * 32 + (32 - size) / 2); expect(y).toBe(row * 32 + (32 - size) / 2);
      const source = rasterUi(name, size);
      for (let dy = -2; dy < size + 2; dy++) for (let dx = -2; dx < size + 2; dx++) expect(pixel(assets.rgba, assets.width, x + dx, y + dy)).toEqual(pixel(source, size, Math.max(0, Math.min(size - 1, dx)), Math.max(0, Math.min(size - 1, dy))));
      for (let i = 0; i < 32; i++) for (const j of [0, 1, 30, 31]) {
        expect(pixel(assets.rgba, assets.width, column * 32 + i, row * 32 + j)[3]).toBe(0);
        expect(pixel(assets.rgba, assets.width, column * 32 + j, row * 32 + i)[3]).toBe(0);
      }
    }
    expect(assets.manifest.decorative).toBe(true);
  });
  it('encodes deterministic PNGs and a fully opaque nine-column contact sheet', () => {
    const one = createUiAssets(), two = createUiAssets();
    expect(one.atlasJson).toBe(two.atlasJson); expect(one.iconsJson).toBe(two.iconsJson);
    expect(digest(one.atlasPng)).toBe(digest(two.atlasPng)); expect(digest(one.contactSheetPng)).toBe(digest(two.contactSheetPng));
    expect(decodePng(one.atlasPng)).toEqual({ width: 288, height: 64, rgba: one.rgba });
    const sheet = decodePng(one.contactSheetPng);
    expect(sheet.width).toBe(432); expect(sheet.height).toBe(192);
    expect([...sheet.rgba.filter((_, i) => i % 4 === 3)].every(alpha => alpha === 255)).toBe(true);
  });
  it('keeps runtime/review files and provenance hashes aligned with the editable source', async () => {
    const assets = createUiAssets();
    for (const directory of ['assets/atlases', 'apps/web/public/art']) {
      expect(await readFile(`${directory}/ui.png`)).toEqual(assets.atlasPng);
      expect(await readFile(`${directory}/ui.json`, 'utf8')).toBe(assets.atlasJson);
      expect(await readFile(`${directory}/ui-icons.json`, 'utf8')).toBe(assets.iconsJson);
      expect(await readFile(`${directory}/ui-contact-sheet.png`)).toEqual(assets.contactSheetPng);
      const source = JSON.parse(await readFile(`${directory}/ui-source.json`, 'utf8')) as { sourceSha256: string; atlasSha256: string; nativeAsepriteSource: boolean };
      expect(source.sourceSha256).toBe(digest(await readFile('packages/art/src/ui.ts')));
      expect(source.atlasSha256).toBe(digest(assets.atlasPng)); expect(source.nativeAsepriteSource).toBe(false);
      expect(await readFile(`${directory}/ui-review.html`, 'utf8')).toContain('No simulation or provider calls');
    }
    const component = await readFile('apps/web/components/Pictogram.tsx', 'utf8');
    expect(component).toContain('aria-hidden="true"'); expect(component).toContain('ui-icon');
    expect(component).toContain('uiAtlasFrame(name, size)'); expect(component).not.toContain('role=');
  });
  it('check mode never creates, repairs or overwrites artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ui-art-'));
    try {
      await mkdir(join(root, 'packages/art/src'), { recursive: true });
      await writeFile(join(root, 'packages/art/src/ui.ts'), await readFile('packages/art/src/ui.ts'));
      await expect(checkUiAssets(root)).rejects.toThrow('missing');
      await expect(stat(join(root, 'assets'))).rejects.toMatchObject({ code: 'ENOENT' });
      await exportUiAssets(root);
      const file = join(root, 'apps/web/public/art/ui.json'), before = await stat(file);
      await checkUiAssets(root); const after = await stat(file);
      expect(after.mtimeMs).toBe(before.mtimeMs); expect(after.ctimeMs).toBe(before.ctimeMs);
      await writeFile(file, 'user modified');
      await expect(checkUiAssets(root)).rejects.toThrow('apps/web/public/art/ui.json');
      expect(await readFile(file, 'utf8')).toBe('user modified');
      await rm(join(root, 'assets/atlases/ui.png'));
      await expect(checkUiAssets(root)).rejects.toThrow('assets/atlases/ui.png (missing)');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
