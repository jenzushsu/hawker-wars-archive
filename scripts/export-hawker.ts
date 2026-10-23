import { deflateSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAWKER_CLIPS, HAWKER_SIZE, HAWKER_SKINS, hawkerFrameName, hawkerRects, type HawkerClip, type HawkerSkin } from '../packages/art/src/hawker.js';

export const HAWKER_EXPORT = { schemaVersion: 'hawker-art-1', size: 32, columns: 16, extrusion: 2, padding: 2, cellSize: 40 } as const;
export interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated: false; trimmed: false;
  spriteSourceSize: { x: 0; y: 0; w: 32; h: 32 };
  sourceSize: { w: 32; h: 32 };
  pivot: { x: 0.5; y: 1 };
}
export interface HawkerAtlas {
  frames: Record<string, AtlasFrame>;
  meta: { app: string; version: string; image: string; format: 'RGBA8888'; size: { w: number; h: number }; scale: '1'; source: string; extrusion: number; padding: number };
}
export interface HawkerClipsManifest {
  schemaVersion: 'hawker-clips-1'; artworkVersion: 'hawker-art-1'; texture: 'hawker'; frameSize: { w: 32; h: 32 }; origin: { x: 0.5; y: 1 };
  skins: readonly HawkerSkin[];
  clips: Record<HawkerClip, { frames: number; fps: number; loop: boolean; durationMs: number; frameNames: Record<HawkerSkin, string[]> }>;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type, 'ascii'), header = Buffer.alloc(4), checksum = Buffer.alloc(4);
  header.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, checksum]);
}
/** PNG RGBA8, filter0, fixed zlib settings, no dates or platform-specific encoders. */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 4096 || height > 4096 || rgba.length !== width * height * 4) throw new RangeError('Invalid image dimensions');
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
export function rasterHawker(skin: HawkerSkin, clip: HawkerClip, index: number): Uint8Array {
  const pixels = new Uint8Array(HAWKER_SIZE * HAWKER_SIZE * 4);
  for (const {x,y,w,h,color} of hawkerRects(skin, clip, index)) {
    if (![x,y,w,h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > HAWKER_SIZE || y + h > HAWKER_SIZE) throw new Error('Art rectangle outside fixed frame');
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const offset = (yy * HAWKER_SIZE + xx) * 4;
      pixels[offset] = color >>> 16; pixels[offset + 1] = color >>> 8; pixels[offset + 2] = color; pixels[offset + 3] = 255;
    }
  }
  return pixels;
}
function blit(target: Uint8Array, width: number, source: Uint8Array, sourceWidth: number, sourceHeight: number, x: number, y: number) {
  for (let yy = 0; yy < sourceHeight; yy++) target.set(source.subarray(yy * sourceWidth * 4, (yy + 1) * sourceWidth * 4), ((y + yy) * width + x) * 4);
}
function extrude(target: Uint8Array, width: number, frame: AtlasFrame['frame']) {
  // Clamp to the source edge, including corners; transparent edge pixels remain transparent.
  for (let dy = -2; dy < frame.h + 2; dy++) for (let dx = -2; dx < frame.w + 2; dx++) {
    if (dx >= 0 && dx < frame.w && dy >= 0 && dy < frame.h) continue;
    const sx = frame.x + Math.max(0, Math.min(frame.w - 1, dx)), sy = frame.y + Math.max(0, Math.min(frame.h - 1, dy));
    const from = (sy * width + sx) * 4, to = ((frame.y + dy) * width + frame.x + dx) * 4;
    target.set(target.subarray(from, from + 4), to);
  }
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function createHawkerAssets() {
  const clipNames = Object.keys(HAWKER_CLIPS) as HawkerClip[];
  const frameCount = HAWKER_SKINS.length * clipNames.reduce((n, clip) => n + HAWKER_CLIPS[clip].frames, 0);
  const width = HAWKER_EXPORT.columns * HAWKER_EXPORT.cellSize, height = Math.ceil(frameCount / HAWKER_EXPORT.columns) * HAWKER_EXPORT.cellSize;
  const rgba = new Uint8Array(width * height * 4);
  const atlas: HawkerAtlas = { frames: {}, meta: { app: 'Hawker Wars original rectangle artwork exporter', version: HAWKER_EXPORT.schemaVersion, image: 'hawker.png', format: 'RGBA8888', size: { w: width, h: height }, scale: '1', source: 'packages/art/src/hawker.ts', extrusion: 2, padding: 2 } };
  const clips = {} as HawkerClipsManifest['clips'];
  for (const clip of clipNames) {
    const spec = HAWKER_CLIPS[clip];
    clips[clip] = { ...spec, durationMs: spec.frames / spec.fps * 1000, frameNames: Object.fromEntries(HAWKER_SKINS.map(skin => [skin, Array.from({length:spec.frames}, (_, i) => hawkerFrameName(skin,clip,i))])) as Record<HawkerSkin,string[]> };
  }
  const manifest: HawkerClipsManifest = { schemaVersion: 'hawker-clips-1', artworkVersion: 'hawker-art-1', texture: 'hawker', frameSize: { w:32,h:32 }, origin:{x:0.5,y:1}, skins: HAWKER_SKINS, clips };
  // Contact sheet rows: green six clips, blue six clips, amber six clips. Columns are frame indexes0..7.
  const sheetWidth = 8 * 40, sheetHeight = HAWKER_SKINS.length * clipNames.length * 40;
  const sheet = new Uint8Array(sheetWidth * sheetHeight * 4);
  for (let yy = 0; yy < sheetHeight; yy++) for (let xx = 0; xx < sheetWidth; xx++) {
    const offset = (yy * sheetWidth + xx) * 4, checker = ((Math.floor(xx / 8) + Math.floor(yy / 8)) % 2) === 0;
    sheet.set(checker ? [226,217,192,255] : [211,200,169,255], offset);
  }
  let n = 0;
  for (const [skinIndex, skin] of HAWKER_SKINS.entries()) for (const [clipIndex, clip] of clipNames.entries()) {
    for (let index = 0; index < HAWKER_CLIPS[clip].frames; index++, n++) {
      const frame = { x: n % HAWKER_EXPORT.columns * 40 + 4, y: Math.floor(n / HAWKER_EXPORT.columns) * 40 + 4, w:32,h:32 };
      const pixels = rasterHawker(skin,clip,index);
      blit(rgba,width,pixels,32,32,frame.x,frame.y); extrude(rgba,width,frame);
      atlas.frames[hawkerFrameName(skin,clip,index)] = { frame, rotated:false, trimmed:false, spriteSourceSize:{x:0,y:0,w:32,h:32}, sourceSize:{w:32,h:32}, pivot:{x:0.5,y:1} };
      const sheetX = index * 40 + 4, sheetY = (skinIndex * clipNames.length + clipIndex) * 40 + 4;
      // Alpha composite source over the review checkerboard.
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const from = (y * 32 + x) * 4;
        if (pixels[from + 3]) sheet.set(pixels.subarray(from,from + 4), ((sheetY + y) * sheetWidth + sheetX + x) * 4);
      }
    }
  }
  return { atlas, manifest, rgba, width, height, atlasPng:encodeRgbaPng(width,height,rgba), atlasJson:json(atlas), clipsJson:json(manifest), contactSheetPng:encodeRgbaPng(sheetWidth,sheetHeight,sheet) };
}

const reviewHtml = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hawker animation review</title>
<style>body{background:#292e27;color:#f4edd1;font:16px/1.5 system-ui;max-width:980px;margin:40px auto;padding:0 20px}h1{font-size:28px}button,select{font:inherit;background:#e8dfc5;color:#292e27;border:0;padding:8px 16px;margin-right:12px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-top:24px}article{background:#42483b;padding:16px}canvas{display:block;width:128px;height:128px;image-rendering:pixelated;background:repeating-conic-gradient(#d3c8a9 0% 25%,#e2d9c0 0% 50%) 50%/32px 32px;margin:12px auto}h2{margin:0;font-size:20px}p{max-width:75ch}small{display:block;color:#d3c8a9}</style>
<h1>Original hawker · six animation clips</h1><p>Editable rectangle source, authored for this project. Fixed32×32 frames; bottom-centre origin. Reduced motion shows each first pose. Replay restarts all six clips.</p>
<label>Stall palette <select id="skin"><option>green</option><option>blue</option><option>amber</option></select></label><button id="replay">Replay clips</button><p id="status" role="status">Loading local atlas…</p><main id="clips"></main>
<p>Contact sheet rows: green, blue, amber; within each palette: idle, prepare, serve, waiting, shortage, celebrate. Columns show frame0 onwards.</p><a href="hawker-contact-sheet.png" style="color:#e2bc65">Open full contact sheet</a>
<script type="module">
const [atlas, manifest] = await Promise.all(['hawker.json','hawker-clips.json'].map(path=>fetch(path).then(r=>{if(!r.ok)throw Error('Atlas unavailable');return r.json()})));
const image = new Image(); image.src='hawker.png'; await image.decode();
const motion = matchMedia('(prefers-reduced-motion: reduce)'); let start=performance.now();
const panels=Object.entries(manifest.clips).map(([name,spec])=>{const article=document.createElement('article');const heading=document.createElement('h2');heading.textContent=name;article.append(heading);const canvas=document.createElement('canvas');canvas.width=canvas.height=32;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',name+' hawker animation');article.append(canvas);const note=document.createElement('small');note.textContent=spec.frames+' frames · '+spec.fps+' fps · '+(spec.loop?'loop':'plays once');article.append(note);document.querySelector('main').append(article);return {spec,context:canvas.getContext('2d')};});
document.querySelector('#replay').onclick=()=>{start=performance.now()};document.querySelector('#skin').onchange=()=>{start=performance.now()};
function draw(now){const skin=document.querySelector('#skin').value;for(const {spec,context} of panels){let index=motion.matches?0:Math.floor((now-start)*spec.fps/1000);index=spec.loop?index%spec.frames:Math.min(index,spec.frames-1);const f=atlas.frames[spec.frameNames[skin][index]].frame;context.clearRect(0,0,32,32);context.imageSmoothingEnabled=false;context.drawImage(image,f.x,f.y,32,32,0,0,32,32)}document.querySelector('#status').textContent=motion.matches?'Reduced motion: static first poses.':'Playing local sprite atlas. No simulation or provider calls.';requestAnimationFrame(draw)}requestAnimationFrame(draw);
</script></html>\n`;

async function exportFiles(root: string) {
  const assets = createHawkerAssets();
  const source = await readFile(resolve(root,'packages/art/src/hawker.ts'));
  const provenance = json({ schemaVersion:'hawker-source-1', author:'Hawker Wars project original artwork', source:'packages/art/src/hawker.ts', sourceSha256:createHash('sha256').update(source).digest('hex'), method:'Code-authored editable pixel rectangles; no external imagery', nativeAsepriteSource:false, exportCommand:'pnpm exec tsx scripts/export-hawker.ts', atlasSha256:createHash('sha256').update(assets.atlasPng).digest('hex') });
  const files = [['hawker.png',assets.atlasPng],['hawker.json',assets.atlasJson],['hawker-clips.json',assets.clipsJson],['hawker-contact-sheet.png',assets.contactSheetPng],['hawker-source.json',provenance],['hawker-review.html',reviewHtml]] as const;
  return { assets, files };
}
export async function exportHawkerAssets(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const {assets,files} = await exportFiles(root);
  for (const directory of ['assets/atlases','apps/web/public/art']) {
    const output = resolve(root,directory); await mkdir(output,{recursive:true});
    for (const [name,data] of files) await writeFile(resolve(output,name),data);
  }
  return assets;
}
/** Read-only verification: never repairs, rewrites or creates an output directory. */
export async function checkHawkerAssets(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const {assets,files} = await exportFiles(root), stale: string[] = [];
  for (const directory of ['assets/atlases','apps/web/public/art']) for (const [name,data] of files) {
    const path = resolve(root,directory,name);
    try { if (!(await readFile(path)).equals(Buffer.from(data))) stale.push(`${directory}/${name}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') stale.push(`${directory}/${name} (missing)`); else throw error; }
  }
  if (stale.length) throw new Error(`Hawker artifacts are stale; run pnpm art:export:\n${stale.join('\n')}`);
  return assets;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Usage: export-hawker.ts [--check]');
  const check = args.includes('--check');
  const assets = await (check ? checkHawkerAssets() : exportHawkerAssets());
  console.log(`${check ? 'Verified' : 'Exported'} ${Object.keys(assets.atlas.frames).length} original hawker frames (${assets.width}×${assets.height})${check ? ' without writing files' : '; review /art/hawker-review.html'}`);
}
