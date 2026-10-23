import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_ATLAS_SIZE, UI_ICON_NAMES, UI_ICON_SIZES, uiAtlasFrame, uiFrameName, uiRects, type UiIconName, type UiIconSize } from '../packages/art/src/ui.js';
import { encodeRgbaPng } from './export-hawker.js';

export const UI_EXPORT = Object.freeze({ schemaVersion: 'ui-art-1', extrusion: 2, minimumPadding: 2, cellSize: 32 });
export function rasterUi(name: UiIconName, size: UiIconSize): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (const { x, y, w, h, color } of uiRects(name, size)) {
    if (![x, y, w, h].every(Number.isInteger) || x < 1 || y < 1 || w < 1 || h < 1 || x + w >= size || y + h >= size || !Number.isInteger(color) || color < 0 || color > 0xffffff) throw new Error('UI rectangle violates the integer grid or transparent-border contract');
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) pixels.set([color >>> 16, color >>> 8 & 255, color & 255, 255], (yy * size + xx) * 4);
  }
  return pixels;
}
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
export function createUiAssets() {
  const { width, height } = UI_ATLAS_SIZE, rgba = new Uint8Array(width * height * 4);
  const frames: Record<string, { frame: ReturnType<typeof uiAtlasFrame>; rotated: false; trimmed: false; spriteSourceSize: { x: 0; y: 0; w: UiIconSize; h: UiIconSize }; sourceSize: { w: UiIconSize; h: UiIconSize }; pivot: { x: 0.5; y: 0.5 } }> = {};
  const sheetWidth = 432, sheetHeight = 192, sheet = new Uint8Array(sheetWidth * sheetHeight * 4);
  for (let y = 0; y < sheetHeight; y++) for (let x = 0; x < sheetWidth; x++) sheet.set((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? [211, 200, 169, 255] : [244, 236, 217, 255], (y * sheetWidth + x) * 4);
  for (const [row, size] of UI_ICON_SIZES.entries()) for (const [column, name] of UI_ICON_NAMES.entries()) {
    const source = rasterUi(name, size), frame = uiAtlasFrame(name, size);
    for (let dy = -2; dy < size + 2; dy++) for (let dx = -2; dx < size + 2; dx++) {
      const from = (Math.max(0, Math.min(size - 1, dy)) * size + Math.max(0, Math.min(size - 1, dx))) * 4;
      rgba.set(source.subarray(from, from + 4), ((frame.y + dy) * width + frame.x + dx) * 4);
    }
    frames[uiFrameName(name, size)] = { frame, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: size, h: size }, sourceSize: { w: size, h: size }, pivot: { x: 0.5, y: 0.5 } };
    // Both rows are shown at their exact 2× integer scale; no smoothing or resampling.
    const x0 = column * 48 + (48 - size * 2) / 2, y0 = row * 96 + 24;
    for (let y = 0; y < size * 2; y++) for (let x = 0; x < size * 2; x++) {
      const from = (Math.floor(y / 2) * size + Math.floor(x / 2)) * 4;
      if (source[from + 3]) sheet.set(source.subarray(from, from + 4), ((y0 + y) * sheetWidth + x0 + x) * 4);
    }
  }
  const atlas = { frames, meta: { app: 'Hawker Wars original pixel pictogram exporter', version: UI_EXPORT.schemaVersion, image: 'ui.png', format: 'RGBA8888', size: { w: width, h: height }, scale: '1', source: 'packages/art/src/ui.ts', extrusion: 2, minimumPadding: 2 } };
  const manifest = { schemaVersion: 'ui-icons-1', texture: 'ui', names: UI_ICON_NAMES, sizes: UI_ICON_SIZES, framePattern: 'ui/{name}/{size}', decorative: true, accessibleMeaning: 'Adjacent visible text', frames: UI_ICON_NAMES.map(name => ({ name, frames: UI_ICON_SIZES.map(size => ({ size, frame: uiFrameName(name, size) })) })) };
  return { width, height, rgba, atlas, manifest, atlasPng: encodeRgbaPng(width, height, rgba), atlasJson: json(atlas), iconsJson: json(manifest), contactSheetPng: encodeRgbaPng(sheetWidth, sheetHeight, sheet) };
}
const reviewHtml = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Original UI pictograms review</title>
<style>body{background:#f4ecd9;color:#443f34;font:16px/1.5 system-ui;max-width:1000px;margin:40px auto;padding:0 20px}h1{font-size:28px}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:20px;margin:24px 0}figure{margin:0;padding:12px;background:#e2d9c0;text-align:center}canvas{display:block;margin:0 auto 12px;image-rendering:pixelated}h2{font-size:20px}a{color:#42664a}figcaption{font-size:14px}</style>
<h1>Original hawker pictograms</h1><p>Nine original rectangle drawings in 16px and 24px integer grids. Decorative companions to visible labels; never the sole accessible name or status signal.</p><p><a href="ui-contact-sheet.png">Contact sheet</a> · <a href="ui-source.json">Provenance and hashes</a></p><p id="status" role="status">Loading local atlas…</p><main></main>
<script type="module">
const atlas=await fetch('ui.json').then(r=>{if(!r.ok)throw Error('Atlas unavailable');return r.json()});const image=new Image();image.src='ui.png';await image.decode();
for(const size of [16,24]){const heading=document.createElement('h2');heading.textContent=size+'px · displayed at 2×';document.querySelector('main').append(heading);const section=document.createElement('section');for(const name of ['inventory','queue','time','latency','warning','validation','vote','sound','expand']){const figure=document.createElement('figure'),canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;canvas.style.width=size*2+'px';canvas.style.height=size*2+'px';canvas.setAttribute('aria-hidden','true');const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;const f=atlas.frames['ui/'+name+'/'+size].frame;context.drawImage(image,f.x,f.y,f.w,f.h,0,0,size,size);const caption=document.createElement('figcaption');caption.textContent=name;figure.append(canvas,caption);section.append(figure)}document.querySelector('main').append(section)}document.querySelector('#status').textContent='Static local artwork only. No simulation or provider calls.';
</script></html>\n`;
async function exportFiles(root: string) {
  const assets = createUiAssets(), source = await readFile(resolve(root, 'packages/art/src/ui.ts'));
  const provenance = json({ schemaVersion: 'ui-source-1', author: 'Hawker Wars project original artwork', source: 'packages/art/src/ui.ts', sourceSha256: createHash('sha256').update(source).digest('hex'), method: 'Code-authored editable integer pixel rectangles; 24px variant snapped from authored geometry; no external imagery, fonts or icon library', nativeAsepriteSource: false, sourceRectanglesSha256: createHash('sha256').update(json(UI_ICON_SIZES.map(size => UI_ICON_NAMES.map(name => ({ name, size, rectangles: uiRects(name, size) }))))).digest('hex'), exportCommand: 'pnpm exec tsx scripts/export-ui.ts', atlasSha256: createHash('sha256').update(assets.atlasPng).digest('hex'), contactSheet: { columns: 9, rows: 2, names: UI_ICON_NAMES, sizes: UI_ICON_SIZES, displayScale: 2 } });
  const files = [['ui.png', assets.atlasPng], ['ui.json', assets.atlasJson], ['ui-icons.json', assets.iconsJson], ['ui-contact-sheet.png', assets.contactSheetPng], ['ui-source.json', provenance], ['ui-review.html', reviewHtml]] as const;
  return { assets, files };
}
export async function exportUiAssets(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const { assets, files } = await exportFiles(root);
  for (const directory of ['assets/atlases', 'apps/web/public/art']) {
    const output = resolve(root, directory); await mkdir(output, { recursive: true });
    for (const [name, data] of files) await writeFile(resolve(output, name), data);
  }
  return assets;
}
/** Read-only verification: a missing or modified artifact is reported and never repaired. */
export async function checkUiAssets(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const { assets, files } = await exportFiles(root), stale: string[] = [];
  for (const directory of ['assets/atlases', 'apps/web/public/art']) for (const [name, data] of files) {
    try { if (!(await readFile(resolve(root, directory, name))).equals(Buffer.from(data))) stale.push(`${directory}/${name}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') stale.push(`${directory}/${name} (missing)`); else throw error; }
  }
  if (stale.length) throw new Error(`UI artifacts are stale; run pnpm exec tsx scripts/export-ui.ts:\n${stale.join('\n')}`);
  return assets;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Usage: export-ui.ts [--check]');
  const check = args.includes('--check'), assets = await (check ? checkUiAssets() : exportUiAssets());
  console.log(`${check ? 'Verified' : 'Exported'} original 16px/24px UI pictograms (${assets.width}×${assets.height})${check ? ' without writing files' : '; review /art/ui-review.html'}`);
}
