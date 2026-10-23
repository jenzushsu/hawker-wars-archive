import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFECT_CLIPS, EFFECT_SIZE, effectFrameName, effectRects, type EffectClip } from '../packages/art/src/effects.js';
import { encodeRgbaPng } from './export-hawker.js';

export const EFFECT_EXPORT = {
  schemaVersion: 'effects-art-1', columns: 8, cellSize: 40, extrusion: 2, padding: 2,
} as const;
export interface EffectAtlasFrame {
  frame: { x: number; y: number; w: 32; h: 32 };
  rotated: false; trimmed: false;
  spriteSourceSize: { x: 0; y: 0; w: 32; h: 32 }; sourceSize: { w: 32; h: 32 };
  pivot: { x: 0.5; y: 1 };
}
export interface EffectsAtlas {
  frames: Record<string, EffectAtlasFrame>;
  meta: {
    app: string; version: 'effects-art-1'; image: 'effects.png'; format: 'RGBA8888';
    size: { w: number; h: number }; scale: '1'; source: string; extrusion: 2; padding: 2;
  };
}
export interface EffectsClipsManifest {
  schemaVersion: 'effects-clips-1'; artworkVersion: 'effects-art-1'; texture: 'effects';
  frameSize: { w: 32; h: 32 }; origin: { x: 0.5; y: 1 };
  clips: Record<EffectClip, { frames: number; fps: number; loop: boolean; durationMs: number; frameNames: string[] }>;
}

const clipNames = Object.keys(EFFECT_CLIPS) as EffectClip[];
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function rasterEffect(clip: EffectClip, index: number): Uint8Array {
  const pixels = new Uint8Array(EFFECT_SIZE * EFFECT_SIZE * 4);
  for (const { x, y, w, h, color } of effectRects(clip, index)) {
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > EFFECT_SIZE || y + h > EFFECT_SIZE) throw new Error('Effect rectangle outside fixed frame');
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const offset = (yy * EFFECT_SIZE + xx) * 4;
      pixels[offset] = color >>> 16; pixels[offset + 1] = color >>> 8;
      pixels[offset + 2] = color; pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export function createEffectsAssets() {
  const count = clipNames.reduce((sum, clip) => sum + EFFECT_CLIPS[clip].frames, 0);
  const width = EFFECT_EXPORT.columns * EFFECT_EXPORT.cellSize;
  const height = Math.ceil(count / EFFECT_EXPORT.columns) * EFFECT_EXPORT.cellSize;
  const rgba = new Uint8Array(width * height * 4);
  const atlas: EffectsAtlas = {
    frames: {}, meta: {
      app: 'Hawker Wars original effects rectangle artwork exporter', version: 'effects-art-1',
      image: 'effects.png', format: 'RGBA8888', size: { w: width, h: height }, scale: '1',
      source: 'packages/art/src/effects.ts', extrusion: 2, padding: 2,
    },
  };
  const clips = {} as EffectsClipsManifest['clips'];
  const sheetWidth = 4 * EFFECT_EXPORT.cellSize, sheetHeight = clipNames.length * EFFECT_EXPORT.cellSize;
  const sheet = new Uint8Array(sheetWidth * sheetHeight * 4);
  for (let y = 0; y < sheetHeight; y++) for (let x = 0; x < sheetWidth; x++) {
    const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
    sheet.set(checker ? [226, 217, 192, 255] : [211, 200, 169, 255], (y * sheetWidth + x) * 4);
  }
  let n = 0;
  for (const [clipIndex, clip] of clipNames.entries()) {
    const spec = EFFECT_CLIPS[clip];
    clips[clip] = {
      ...spec, durationMs: spec.frames / spec.fps * 1000,
      frameNames: Array.from({ length: spec.frames }, (_, index) => effectFrameName(clip, index)),
    };
    for (let index = 0; index < spec.frames; index++, n++) {
      const frame = {
        x: n % EFFECT_EXPORT.columns * EFFECT_EXPORT.cellSize + 4,
        y: Math.floor(n / EFFECT_EXPORT.columns) * EFFECT_EXPORT.cellSize + 4,
        w: 32 as const, h: 32 as const,
      };
      const pixels = rasterEffect(clip, index);
      // Two pixels of edge clamping on each side, then two untouched padding pixels.
      for (let y = -2; y < 34; y++) for (let x = -2; x < 34; x++) {
        const from = (Math.max(0, Math.min(31, y)) * 32 + Math.max(0, Math.min(31, x))) * 4;
        rgba.set(pixels.subarray(from, from + 4), ((frame.y + y) * width + frame.x + x) * 4);
      }
      atlas.frames[effectFrameName(clip, index)] = {
        frame, rotated: false, trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 }, sourceSize: { w: 32, h: 32 }, pivot: { x: 0.5, y: 1 },
      };
      const sheetX = index * EFFECT_EXPORT.cellSize + 4, sheetY = clipIndex * EFFECT_EXPORT.cellSize + 4;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const from = (y * 32 + x) * 4;
        if (pixels[from + 3]) sheet.set(pixels.subarray(from, from + 4), ((sheetY + y) * sheetWidth + sheetX + x) * 4);
      }
    }
  }
  const manifest: EffectsClipsManifest = {
    schemaVersion: 'effects-clips-1', artworkVersion: 'effects-art-1', texture: 'effects',
    frameSize: { w: 32, h: 32 }, origin: { x: 0.5, y: 1 }, clips,
  };
  return {
    atlas, manifest, width, height, rgba, sheetWidth, sheetHeight,
    atlasPng: encodeRgbaPng(width, height, rgba), atlasJson: json(atlas), clipsJson: json(manifest),
    contactSheetPng: encodeRgbaPng(sheetWidth, sheetHeight, sheet),
  };
}

const reviewHtml = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Effects animation review</title>
<style>body{background:#292e27;color:#f4edd1;font:16px/1.5 system-ui;max-width:980px;margin:40px auto;padding:0 20px}h1{font-size:28px}button{font:inherit;background:#e8dfc5;color:#292e27;border:0;padding:8px 16px;margin:4px 12px 4px 0}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-top:24px}article{background:#42483b;padding:16px}canvas{display:block;width:128px;height:128px;image-rendering:pixelated;background:repeating-conic-gradient(#d3c8a9 0% 25%,#e2d9c0 0% 50%) 50%/32px 32px;margin:12px auto}h2{margin:0;font-size:20px}p{max-width:75ch}small{display:block;color:#d3c8a9}a{color:#e2bc65}</style>
<h1>Original hawker-centre effects</h1><p>Steam, a service glint, an empty tray, a delivery crate, and bus, rain and supplier-delay cues. Fixed 32×32 frames; bottom-centre origin. The shortage tray stays still. Reduced motion shows each first pose.</p>
<button id="replay">Replay clips</button><button id="pause" aria-pressed="false">Pause</button><p id="status" role="status">Loading local atlas…</p><main></main>
<p>Contact-sheet rows: steam, service, shortage, delivery, bus, rain, supplier-delay. Columns are frames 0–3. Shortage has one persistent frame.</p><a href="effects-contact-sheet.png">Open contact sheet</a>
<script type="module">
const status=document.querySelector('#status');
try {
const [atlas,manifest]=await Promise.all(['effects.json','effects-clips.json'].map(path=>fetch(path).then(r=>{if(!r.ok)throw Error('Missing local atlas');return r.json()})));
const image=new Image();image.src='effects.png';await image.decode();
const reduced=matchMedia('(prefers-reduced-motion: reduce)');let elapsed=0,last=performance.now(),paused=false;
const panels=Object.entries(manifest.clips).map(([name,spec])=>{const article=document.createElement('article'),heading=document.createElement('h2'),canvas=document.createElement('canvas'),note=document.createElement('small');heading.textContent=name.replace('-',' ');canvas.width=canvas.height=32;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',name+' effect');note.textContent=spec.frames===1?'Persistent static cue':spec.frames+' frames · '+spec.fps+' fps · '+(spec.loop?'loop':'plays once');article.append(heading,canvas,note);document.querySelector('main').append(article);return{spec,context:canvas.getContext('2d')}});
document.querySelector('#replay').onclick=()=>{elapsed=0;last=performance.now()};document.querySelector('#pause').onclick=event=>{paused=!paused;event.currentTarget.textContent=paused?'Resume':'Pause';event.currentTarget.setAttribute('aria-pressed',String(paused));last=performance.now()};
function draw(now){if(!paused&&!reduced.matches)elapsed+=now-last;last=now;for(const{spec,context}of panels){let frame=reduced.matches?0:Math.floor(elapsed*spec.fps/1000);frame=spec.loop?frame%spec.frames:Math.min(frame,spec.frames-1);const f=atlas.frames[spec.frameNames[frame]].frame;context.clearRect(0,0,32,32);context.imageSmoothingEnabled=false;context.drawImage(image,f.x,f.y,32,32,0,0,32,32)}const message=reduced.matches?'Reduced motion: static first poses.':paused?'Animation paused.':'Playing local artwork. No simulation or provider calls.';if(status.textContent!==message)status.textContent=message;requestAnimationFrame(draw)}requestAnimationFrame(draw);
}catch(error){status.textContent='The local effects atlas could not load. Export the effects and serve this page from the web app.'}
</script></html>\n`;

async function exportFiles(root: string) {
  const assets = createEffectsAssets(), source = await readFile(resolve(root, 'packages/art/src/effects.ts'));
  const provenance = json({
    schemaVersion: 'effects-source-1', author: 'Hawker Wars project original artwork',
    source: 'packages/art/src/effects.ts', sourceSha256: sha256(source),
    method: 'Code-authored editable pixel rectangles; incumbent Arena palette; no external imagery',
    nativeAsepriteSource: false, exportCommand: 'pnpm exec tsx scripts/export-effects.ts', atlasSha256: sha256(assets.atlasPng),
  });
  const files = [
    ['effects.png', assets.atlasPng], ['effects.json', assets.atlasJson], ['effects-clips.json', assets.clipsJson],
    ['effects-contact-sheet.png', assets.contactSheetPng], ['effects-source.json', provenance], ['effects-review.html', reviewHtml],
  ] as const;
  return { assets, files };
}
export async function exportEffectsAssets(root = projectRoot) {
  const { assets, files } = await exportFiles(root);
  for (const directory of ['assets/atlases', 'apps/web/public/art']) {
    const output = resolve(root, directory); await mkdir(output, { recursive: true });
    for (const [name, data] of files) await writeFile(resolve(output, name), data);
  }
  return assets;
}
/** Read-only verification: never creates, repairs or rewrites an artifact. */
export async function checkEffectsAssets(root = projectRoot) {
  const { assets, files } = await exportFiles(root), stale: string[] = [];
  for (const directory of ['assets/atlases', 'apps/web/public/art']) for (const [name, data] of files) {
    try {
      if (!(await readFile(resolve(root, directory, name))).equals(Buffer.from(data))) stale.push(`${directory}/${name}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') stale.push(`${directory}/${name} (missing)`);
      else throw error;
    }
  }
  if (stale.length) throw new Error(`Effects artifacts are stale; run pnpm exec tsx scripts/export-effects.ts:\n${stale.join('\n')}`);
  return assets;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== '--check')) throw new Error('Usage: export-effects.ts [--check]');
  const check = args.includes('--check'), assets = await (check ? checkEffectsAssets() : exportEffectsAssets());
  console.log(`${check ? 'Verified' : 'Exported'} ${Object.keys(assets.atlas.frames).length} original effect frames (${assets.width}×${assets.height})${check ? ' without writing files' : '; review /art/effects-review.html'}`);
}
