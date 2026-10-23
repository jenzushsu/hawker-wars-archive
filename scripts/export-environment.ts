import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENVIRONMENT_SIZE, ENVIRONMENT_LAYERS, ENVIRONMENT_LAYOUT,
  environmentFrameName, environmentRects, type EnvironmentLayer,
} from '../packages/art/src/environment.js';
import { encodeRgbaPng } from './export-hawker.js';

export const ENVIRONMENT_EXPORT = Object.freeze({ schemaVersion: 'environment-art-1', extrusion: 2, padding: 2, cellWidth: 488, cellHeight: 248 });
export interface EnvironmentAtlasFrame {
  frame: { x: number; y: number; w: 480; h: 240 };
  rotated: false; trimmed: false;
  spriteSourceSize: { x: 0; y: 0; w: 480; h: 240 };
  sourceSize: { w: 480; h: 240 };
  pivot: { x: 0; y: 0 };
}
export interface EnvironmentAtlas {
  frames: Record<string, EnvironmentAtlasFrame>;
  meta: { app: string; version: string; image: 'environment.png'; format: 'RGBA8888'; size: { w: number; h: number }; scale: '1'; source: string; extrusion: 2; padding: 2 };
}
function sourceOver(pixels: Uint8Array, offset: number, red: number, green: number, blue: number, alpha: number): void {
  const destinationAlpha = pixels[offset + 3]! / 255;
  const outAlpha = alpha + destinationAlpha * (1 - alpha);
  if (outAlpha === 0) return;
  for (const [channel, value] of [red, green, blue].entries()) {
    pixels[offset + channel] = Math.round((value * alpha + pixels[offset + channel]! * destinationAlpha * (1 - alpha)) / outAlpha);
  }
  pixels[offset + 3] = Math.round(outAlpha * 255);
}
/** Explicit deterministic source-over rasterization of the original clipped rectangle commands. */
export function rasterEnvironment(layer: EnvironmentLayer): Uint8Array {
  const { width, height } = ENVIRONMENT_SIZE;
  const pixels = new Uint8Array(width * height * 4);
  for (const { x, y, w, h, color, alpha } of environmentRects(layer)) {
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height || !Number.isInteger(color) || color < 0 || color > 0xffffff || !Number.isFinite(alpha) || alpha <= 0 || alpha > 1) throw new Error('Environment command violates the scene rectangle contract');
    const red = color >>> 16, green = (color >>> 8) & 255, blue = color & 255;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) sourceOver(pixels, (yy * width + xx) * 4, red, green, blue, alpha);
  }
  return pixels;
}
function blit(target: Uint8Array, targetWidth: number, source: Uint8Array, sourceWidth: number, sourceHeight: number, x: number, y: number): void {
  for (let yy = 0; yy < sourceHeight; yy++) target.set(source.subarray(yy * sourceWidth * 4, (yy + 1) * sourceWidth * 4), ((y + yy) * targetWidth + x) * 4);
}
function extrude(target: Uint8Array, width: number, frame: EnvironmentAtlasFrame['frame']): void {
  for (let dy = -2; dy < frame.h + 2; dy++) for (let dx = -2; dx < frame.w + 2; dx++) {
    if (dx >= 0 && dx < frame.w && dy >= 0 && dy < frame.h) continue;
    const sourceX = frame.x + Math.max(0, Math.min(frame.w - 1, dx));
    const sourceY = frame.y + Math.max(0, Math.min(frame.h - 1, dy));
    const from = (sourceY * width + sourceX) * 4, to = ((frame.y + dy) * width + frame.x + dx) * 4;
    target.set(target.subarray(from, from + 4), to);
  }
}
function composite(target: Uint8Array, width: number, source: Uint8Array, sourceWidth: number, sourceHeight: number, x: number, y: number): void {
  for (let yy = 0; yy < sourceHeight; yy++) for (let xx = 0; xx < sourceWidth; xx++) {
    const from = (yy * sourceWidth + xx) * 4;
    if (source[from + 3]) sourceOver(target, ((y + yy) * width + x + xx) * 4, source[from]!, source[from + 1]!, source[from + 2]!, source[from + 3]! / 255);
  }
}
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
export function createEnvironmentAssets() {
  const width = ENVIRONMENT_EXPORT.cellWidth, height = ENVIRONMENT_EXPORT.cellHeight * ENVIRONMENT_LAYERS.length;
  const rgba = new Uint8Array(width * height * 4);
  const layers = Object.fromEntries(ENVIRONMENT_LAYERS.map(layer => [layer, rasterEnvironment(layer)])) as Record<EnvironmentLayer, Uint8Array>;
  const atlas: EnvironmentAtlas = { frames: {}, meta: { app: 'Hawker Wars original environment rectangle exporter', version: ENVIRONMENT_EXPORT.schemaVersion, image: 'environment.png', format: 'RGBA8888', size: { w: width, h: height }, scale: '1', source: 'packages/art/src/environment.ts', extrusion: 2, padding: 2 } };
  for (const [index, layer] of ENVIRONMENT_LAYERS.entries()) {
    const frame = { x: 4, y: index * ENVIRONMENT_EXPORT.cellHeight + 4, w: 480 as const, h: 240 as const };
    blit(rgba, width, layers[layer], 480, 240, frame.x, frame.y); extrude(rgba, width, frame);
    atlas.frames[environmentFrameName(layer)] = { frame, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 480, h: 240 }, sourceSize: { w: 480, h: 240 }, pivot: { x: 0, y: 0 } };
  }
  const manifest = {
    schemaVersion: 'environment-layers-1', artworkVersion: ENVIRONMENT_EXPORT.schemaVersion, texture: 'environment',
    sceneSize: ENVIRONMENT_SIZE, origin: { x: 0, y: 0 }, scenePosition: { x: 0, y: 0 },
    layers: ENVIRONMENT_LAYERS.map(layer => ({ id: layer, frame: environmentFrameName(layer) })),
    layout: ENVIRONMENT_LAYOUT,
    drawOrder: ['background', 'hawker-sprites', 'counters', 'queue-customer-sprites', 'seated-customer-sprites', 'foreground', 'steam-effects'],
    includesPeople: false,
  };
  const sheetWidth = 960, sheetHeight = 480;
  const sheet = new Uint8Array(sheetWidth * sheetHeight * 4);
  for (let y = 0; y < sheetHeight; y++) for (let x = 0; x < sheetWidth; x++) {
    const check = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
    sheet.set(check ? [226, 217, 192, 255] : [211, 200, 169, 255], (y * sheetWidth + x) * 4);
  }
  composite(sheet, sheetWidth, layers.background, 480, 240, 0, 0);
  composite(sheet, sheetWidth, layers.counters, 480, 240, 480, 0);
  composite(sheet, sheetWidth, layers.foreground, 480, 240, 0, 240);
  for (const layer of ENVIRONMENT_LAYERS) composite(sheet, sheetWidth, layers[layer], 480, 240, 480, 240);
  return { width, height, rgba, layers, atlas, manifest, atlasPng: encodeRgbaPng(width, height, rgba), atlasJson: json(atlas), layersJson: json(manifest), contactSheetPng: encodeRgbaPng(sheetWidth, sheetHeight, sheet) };
}
const reviewHtml = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hawker environment review</title>
<style>body{background:#292e27;color:#f4edd1;font:16px/1.5 system-ui;max-width:1080px;margin:40px auto;padding:0 20px}h1{font-size:28px}main{display:grid;grid-template-columns:1fr;gap:24px}article{background:#42483b;padding:16px}canvas{display:block;width:100%;max-width:960px;image-rendering:pixelated;background:repeating-conic-gradient(#d3c8a9 0% 25%,#e2d9c0 0% 50%) 50%/16px 16px}h2{margin:0 0 12px;font-size:20px}small{color:#d3c8a9}a{color:#e2bc65}</style>
<h1>Original hawker centre · environment layers</h1><p>Extracted without visual redesign from the original procedural Arena geometry. Every layer is480×240 logical pixels. Counters occlude hawkers; tables occlude seated customers. People are separate sprites, so no customer or hawker is baked into these images.</p><p><a href="environment-contact-sheet.png">Contact sheet</a> · <a href="environment-source.json">Provenance and hashes</a></p><p id="status" role="status">Loading local atlas…</p><main id="layers"></main>
<script type="module">
const atlas=await fetch('environment.json').then(r=>{if(!r.ok)throw Error('Atlas unavailable');return r.json()});const image=new Image();image.src='environment.png';await image.decode();
for(const name of ['background','counters','foreground','composite']){const article=document.createElement('article'),h=document.createElement('h2');h.textContent=name;article.append(h);const canvas=document.createElement('canvas');canvas.width=480;canvas.height=240;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',name+' environment layer, no people');article.append(canvas);const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;for(const layer of name==='composite'?['background','counters','foreground']:[name]){const f=atlas.frames['environment/'+layer].frame;context.drawImage(image,f.x,f.y,f.w,f.h,0,0,480,240)}document.querySelector('main').append(article)}document.querySelector('#status').textContent='Static local artwork only. No simulation or provider calls.';
</script></html>\n`;
async function exportFiles(root: string) {
  const assets = createEnvironmentAssets(), source = await readFile(resolve(root, 'packages/art/src/environment.ts'));
  const provenance = json({ schemaVersion: 'environment-source-1', author: 'Hawker Wars project original artwork', source: 'packages/art/src/environment.ts', sourceSha256: createHash('sha256').update(source).digest('hex'), extractedFrom: 'Original apps/web/components/Arena.tsx architecture, counters and foreground object geometry', method: 'Code-authored editable pixel rectangles and alpha source-over; no external imagery', nativeAsepriteSource: false, includesPeople: false, sourceRectanglesSha256: createHash('sha256').update(json(Object.fromEntries(ENVIRONMENT_LAYERS.map(layer => [layer, environmentRects(layer)])))).digest('hex'), exportCommand: 'pnpm exec tsx scripts/export-environment.ts', atlasSha256: createHash('sha256').update(assets.atlasPng).digest('hex'), contactSheet: { columns: 2, rows: 2, order: ['background', 'counters', 'foreground', 'composite'] } });
  const files = [['environment.png', assets.atlasPng], ['environment.json', assets.atlasJson], ['environment-layers.json', assets.layersJson], ['environment-contact-sheet.png', assets.contactSheetPng], ['environment-source.json', provenance], ['environment-review.html', reviewHtml]] as const;
  return { assets, files };
}
export async function exportEnvironmentAssets(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const { assets, files } = await exportFiles(root);
  for (const directory of ['assets/atlases', 'apps/web/public/art']) {
    const output = resolve(root, directory); await mkdir(output, { recursive: true });
    for (const [name, data] of files) await writeFile(resolve(output, name), data);
  }
  return assets;
}
/** Verification is intentionally read-only, including missing directories and stale user files. */
export async function checkEnvironmentAssets(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const { assets, files } = await exportFiles(root), stale: string[] = [];
  for (const directory of ['assets/atlases', 'apps/web/public/art']) for (const [name, data] of files) {
    try { if (!(await readFile(resolve(root, directory, name))).equals(Buffer.from(data))) stale.push(`${directory}/${name}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') stale.push(`${directory}/${name} (missing)`); else throw error; }
  }
  if (stale.length) throw new Error(`Environment artifacts are stale; run pnpm exec tsx scripts/export-environment.ts:\n${stale.join('\n')}`);
  return assets;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Usage: export-environment.ts [--check]');
  const check = args.includes('--check'), assets = await (check ? checkEnvironmentAssets() : exportEnvironmentAssets());
  console.log(`${check ? 'Verified' : 'Exported'} three original environment layers (${assets.width}×${assets.height})${check ? ' without writing files' : '; review /art/environment-review.html'}`);
}
