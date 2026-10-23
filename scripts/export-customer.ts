import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CUSTOMER_CLIPS, CUSTOMER_DIRECTIONS, CUSTOMER_SIZE, CUSTOMER_SKINS,
  customerFrameName, customerRects,
  type CustomerClip, type CustomerDirection, type CustomerSkin,
} from '../packages/art/src/customer.js';
import { encodeRgbaPng } from './export-hawker.js';

export const CUSTOMER_EXPORT = {
  schemaVersion: 'customer-art-1', columns: 32,
  extrusion: 2, padding: 2, cellSize: { w: 32, h: 40 },
} as const;
export interface CustomerAtlasFrame {
  frame: { x: number; y: number; w: 24; h: 32 };
  rotated: false; trimmed: false;
  spriteSourceSize: { x: 0; y: 0; w: 24; h: 32 };
  sourceSize: { w: 24; h: 32 };
  pivot: { x: 0.5; y: 1 };
}
export interface CustomerAtlas {
  frames: Record<string, CustomerAtlasFrame>;
  meta: {
    app: string; version: 'customer-art-1'; image: 'customer.png'; format: 'RGBA8888';
    size: { w: number; h: number }; scale: '1'; source: string; extrusion: 2; padding: 2;
  };
}
export interface CustomerClipsManifest {
  schemaVersion: 'customer-clips-1'; artworkVersion: 'customer-art-1'; texture: 'customer';
  frameSize: { w: 24; h: 32 }; origin: { x: 0.5; y: 1 };
  skins: readonly CustomerSkin[]; directions: readonly CustomerDirection[];
  clips: Record<CustomerClip, {
    frames: number; fps: number; loop: boolean; durationMs: number;
    frameNames: Record<CustomerSkin, Record<CustomerDirection, string[]>>;
  }>;
}

const clipNames = Object.keys(CUSTOMER_CLIPS) as CustomerClip[];
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every color is opaque; the untouched24×32 canvas remains transparent. */
export function rasterCustomer(skin: CustomerSkin, clip: CustomerClip, direction: CustomerDirection, index: number): Uint8Array {
  const { w: width, h: height } = CUSTOMER_SIZE;
  const pixels = new Uint8Array(width * height * 4);
  for (const { x, y, w, h, color } of customerRects(skin, clip, direction, index)) {
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > width || y + h > height) throw new Error('Customer art rectangle outside fixed frame');
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const offset = (yy * width + xx) * 4;
      pixels[offset] = color >>> 16; pixels[offset + 1] = color >>> 8;
      pixels[offset + 2] = color; pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export function createCustomerAssets() {
  const { w: cellWidth, h: cellHeight } = CUSTOMER_EXPORT.cellSize;
  const count = CUSTOMER_SKINS.length * CUSTOMER_DIRECTIONS.length * clipNames.reduce((sum, clip) => sum + CUSTOMER_CLIPS[clip].frames, 0);
  const width = CUSTOMER_EXPORT.columns * cellWidth, height = Math.ceil(count / CUSTOMER_EXPORT.columns) * cellHeight;
  if (width > 2048 || height > 2048) throw new Error('Customer atlas exceeds maximum2048px texture size');
  const rgba = new Uint8Array(width * height * 4);
  const atlas: CustomerAtlas = {
    frames: {},
    meta: {
      app: 'Hawker Wars original customer rectangle artwork exporter', version: 'customer-art-1',
      image: 'customer.png', format: 'RGBA8888', size: { w: width, h: height }, scale: '1',
      source: 'packages/art/src/customer.ts', extrusion: 2, padding: 2,
    },
  };
  const clips = {} as CustomerClipsManifest['clips'];
  for (const clip of clipNames) {
    const spec = CUSTOMER_CLIPS[clip];
    const frameNames = Object.fromEntries(CUSTOMER_SKINS.map(skin => [skin, Object.fromEntries(
      CUSTOMER_DIRECTIONS.map(direction => [direction, Array.from({ length: spec.frames }, (_, index) => customerFrameName(skin, clip, direction, index))]),
    )])) as Record<CustomerSkin, Record<CustomerDirection, string[]>>;
    clips[clip] = { ...spec, durationMs: spec.frames / spec.fps * 1000, frameNames };
  }
  const manifest: CustomerClipsManifest = {
    schemaVersion: 'customer-clips-1', artworkVersion: 'customer-art-1', texture: 'customer',
    frameSize: CUSTOMER_SIZE, origin: { x: 0.5, y: 1 }, skins: CUSTOMER_SKINS,
    directions: CUSTOMER_DIRECTIONS, clips,
  };
  // Four direction groups, each four frames wide. Rows: six clips for each of six palettes.
  const sheetWidth = CUSTOMER_DIRECTIONS.length * 4 * cellWidth;
  const sheetHeight = CUSTOMER_SKINS.length * clipNames.length * cellHeight;
  const sheet = new Uint8Array(sheetWidth * sheetHeight * 4);
  for (let y = 0; y < sheetHeight; y++) for (let x = 0; x < sheetWidth; x++) {
    const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
    sheet.set(checker ? [226, 217, 192, 255] : [211, 200, 169, 255], (y * sheetWidth + x) * 4);
  }
  let n = 0;
  for (const [skinIndex, skin] of CUSTOMER_SKINS.entries()) for (const [clipIndex, clip] of clipNames.entries()) {
    for (const [directionIndex, direction] of CUSTOMER_DIRECTIONS.entries()) for (let index = 0; index < CUSTOMER_CLIPS[clip].frames; index++, n++) {
      const frame = {
        x: n % CUSTOMER_EXPORT.columns * cellWidth + 4,
        y: Math.floor(n / CUSTOMER_EXPORT.columns) * cellHeight + 4,
        w: 24 as const, h: 32 as const,
      };
      const pixels = rasterCustomer(skin, clip, direction, index);
      // Edge-clamped two-pixel extrusion, including corners. No bleed into the outer padding.
      for (let y = -2; y < frame.h + 2; y++) for (let x = -2; x < frame.w + 2; x++) {
        const from = (Math.max(0, Math.min(frame.h - 1, y)) * frame.w + Math.max(0, Math.min(frame.w - 1, x))) * 4;
        rgba.set(pixels.subarray(from, from + 4), ((frame.y + y) * width + frame.x + x) * 4);
      }
      atlas.frames[customerFrameName(skin, clip, direction, index)] = {
        frame, rotated: false, trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: 24, h: 32 }, sourceSize: { w: 24, h: 32 },
        pivot: { x: 0.5, y: 1 },
      };
      const sheetX = (directionIndex * 4 + index) * cellWidth + 4;
      const sheetY = (skinIndex * clipNames.length + clipIndex) * cellHeight + 4;
      for (let y = 0; y < frame.h; y++) for (let x = 0; x < frame.w; x++) {
        const from = (y * frame.w + x) * 4;
        if (pixels[from + 3]) sheet.set(pixels.subarray(from, from + 4), ((sheetY + y) * sheetWidth + sheetX + x) * 4);
      }
    }
  }
  return {
    atlas, manifest, rgba, width, height, sheetWidth, sheetHeight,
    atlasPng: encodeRgbaPng(width, height, rgba), atlasJson: json(atlas), clipsJson: json(manifest),
    contactSheetPng: encodeRgbaPng(sheetWidth, sheetHeight, sheet),
  };
}

const reviewHtml = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer animation review</title>
<style>body{background:#292e27;color:#f4edd1;font:16px/1.5 system-ui;max-width:980px;margin:40px auto;padding:0 20px}h1{font-size:28px}button,select{font:inherit;background:#e8dfc5;color:#292e27;border:0;padding:8px 12px;margin:4px 12px 4px 0}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-top:24px}article{background:#42483b;padding:16px}canvas{display:block;width:96px;height:128px;image-rendering:pixelated;background:repeating-conic-gradient(#d3c8a9 0% 25%,#e2d9c0 0% 50%) 50%/32px 32px;margin:12px auto}h2{margin:0;font-size:20px}p{max-width:75ch}small{display:block;color:#d3c8a9}a{color:#e2bc65}</style>
<h1>Original customers · six variants, four directions</h1><p>Editable project pixel artwork. Fixed 24×32 frames; bottom-centre origin. Every clip has all four directions. Replay restarts the handoff and departure. Reduced motion shows first poses.</p>
<label>Customer <select id="skin"></select></label><label>Direction <select id="direction"></select></label><button id="replay">Replay clips</button><button id="pause" aria-pressed="false">Pause</button><p id="status" role="status">Loading local atlas…</p><main></main>
<p>Contact sheet: rows are walk, wait, impatient, receive, eat and depart for each palette in selector order. Four groups across are down, left, right and up; each group holds frames 0–3.</p><a href="customer-contact-sheet.png">Open contact sheet</a>
<script type="module">
const status=document.querySelector('#status');
try {
const [atlas,manifest]=await Promise.all(['customer.json','customer-clips.json'].map(path=>fetch(path).then(r=>{if(!r.ok)throw Error('Missing local atlas');return r.json()})));
const image=new Image();image.src='customer.png';await image.decode();
for(const [selector,values] of [['#skin',manifest.skins],['#direction',manifest.directions]])for(const value of values){const option=document.createElement('option');option.value=option.textContent=value;document.querySelector(selector).append(option)}
const reduced=matchMedia('(prefers-reduced-motion: reduce)');let elapsed=0,last=performance.now(),paused=false;
const panels=Object.entries(manifest.clips).map(([name,spec])=>{const article=document.createElement('article'),heading=document.createElement('h2'),canvas=document.createElement('canvas'),note=document.createElement('small');heading.textContent=name;canvas.width=24;canvas.height=32;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',name+' customer animation');note.textContent=spec.frames+' frames · '+spec.fps+' fps · '+(spec.loop?'loop':'plays once');article.append(heading,canvas,note);document.querySelector('main').append(article);return{spec,context:canvas.getContext('2d')}});
const replay=()=>{elapsed=0;last=performance.now()};document.querySelector('#replay').onclick=replay;document.querySelector('#skin').onchange=replay;document.querySelector('#direction').onchange=replay;document.querySelector('#pause').onclick=event=>{paused=!paused;event.currentTarget.textContent=paused?'Resume':'Pause';event.currentTarget.setAttribute('aria-pressed',String(paused));last=performance.now()};
function draw(now){if(!paused&&!reduced.matches)elapsed+=now-last;last=now;const skin=document.querySelector('#skin').value,direction=document.querySelector('#direction').value;for(const{spec,context}of panels){let frame=reduced.matches?0:Math.floor(elapsed*spec.fps/1000);frame=spec.loop?frame%spec.frames:Math.min(frame,spec.frames-1);const f=atlas.frames[spec.frameNames[skin][direction][frame]].frame;context.clearRect(0,0,24,32);context.imageSmoothingEnabled=false;context.drawImage(image,f.x,f.y,24,32,0,0,24,32)}const message=reduced.matches?'Reduced motion: static first poses.':paused?'Animation paused.':'Playing local artwork. No simulation or provider calls.';if(status.textContent!==message)status.textContent=message;requestAnimationFrame(draw)}requestAnimationFrame(draw);
}catch(error){status.textContent='The local customer atlas could not load. Run the customer art export and serve this page from the web app.'}
</script></html>\n`;

async function exportFiles(root: string) {
  const assets = createCustomerAssets();
  const source = await readFile(resolve(root, 'packages/art/src/customer.ts'));
  const provenance = json({
    schemaVersion: 'customer-source-1', author: 'Hawker Wars project original artwork',
    source: 'packages/art/src/customer.ts', sourceSha256: sha256(source),
    method: 'Code-authored editable pixel rectangles; original six Arena customer palettes; no external imagery',
    nativeAsepriteSource: false, exportCommand: 'pnpm exec tsx scripts/export-customer.ts',
    atlasSha256: sha256(assets.atlasPng),
  });
  const files = [
    ['customer.png', assets.atlasPng], ['customer.json', assets.atlasJson],
    ['customer-clips.json', assets.clipsJson], ['customer-contact-sheet.png', assets.contactSheetPng],
    ['customer-source.json', provenance], ['customer-review.html', reviewHtml],
  ] as const;
  return { assets, files };
}
export async function exportCustomerAssets(root = projectRoot) {
  const { assets, files } = await exportFiles(root);
  for (const directory of ['assets/atlases', 'apps/web/public/art']) {
    const output = resolve(root, directory); await mkdir(output, { recursive: true });
    for (const [name, data] of files) await writeFile(resolve(output, name), data);
  }
  return assets;
}
/** Read-only verification: missing/stale outputs are reported and never repaired. */
export async function checkCustomerAssets(root = projectRoot) {
  const { assets, files } = await exportFiles(root), stale: string[] = [];
  for (const directory of ['assets/atlases', 'apps/web/public/art']) for (const [name, data] of files) {
    try {
      if (!(await readFile(resolve(root, directory, name))).equals(Buffer.from(data))) stale.push(`${directory}/${name}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') stale.push(`${directory}/${name} (missing)`);
      else throw error;
    }
  }
  if (stale.length) throw new Error(`Customer artifacts are stale; run pnpm exec tsx scripts/export-customer.ts:\n${stale.join('\n')}`);
  return assets;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== '--check')) throw new Error('Usage: export-customer.ts [--check]');
  const check = args.includes('--check'), assets = await (check ? checkCustomerAssets() : exportCustomerAssets());
  console.log(`${check ? 'Verified' : 'Exported'} ${Object.keys(assets.atlas.frames).length} original customer frames (${assets.width}×${assets.height})${check ? ' without writing files' : '; review /art/customer-review.html'}`);
}
