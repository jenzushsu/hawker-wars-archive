import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EFFECT_CLIPS, EFFECT_SIZE, effectFrameAt, effectFrameName, effectRects, type EffectClip } from '../packages/art/src/effects.js';
import { checkEffectsAssets, createEffectsAssets, exportEffectsAssets, rasterEffect } from '../scripts/export-effects.js';

const clips = Object.keys(EFFECT_CLIPS) as EffectClip[];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function decodePng(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes), compressed: Buffer[] = [];
  expect([...buffer.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10]);
  let width = 0, height = 0;
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); expect([...data.subarray(8)]).toEqual([8,6,0,0,0]); }
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(compressed)), rgba = new Uint8Array(width * height * 4);
  expect(rows.length).toBe((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    expect(rows[y * (width * 4 + 1)]).toBe(0);
    rgba.set(rows.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, rgba };
}

describe('original effects artwork', () => {
  it('specifies all seven cue cadences and persistent shortage semantics', () => {
    expect(EFFECT_SIZE).toBe(32);
    expect(EFFECT_CLIPS).toEqual({
      steam:{frames:4,fps:6,loop:true},service:{frames:4,fps:8,loop:false},shortage:{frames:1,fps:1,loop:true},
      delivery:{frames:4,fps:8,loop:false},bus:{frames:4,fps:8,loop:false},rain:{frames:4,fps:8,loop:true},
      'supplier-delay':{frames:4,fps:8,loop:true},
    });
    for (const clip of clips) {
      const {frames,fps,loop} = EFFECT_CLIPS[clip], interval = 1000 / fps;
      for (let index = 0; index < frames; index++) {
        expect(effectFrameAt(clip,index * interval + 0.001)).toBe(index);
        expect(effectFrameAt(clip,(index + 1) * interval - 0.001)).toBe(index);
      }
      expect(effectFrameAt(clip,frames * interval + 0.001)).toBe(loop ? 0 : frames - 1);
      expect(effectFrameAt(clip,1_000_000)).toBe(loop ? Math.floor(1_000_000 * fps / 1000) % frames : frames - 1);
    }
    for (const time of [0,17,1000,60000,Number.MAX_SAFE_INTEGER]) expect(effectFrameAt('shortage',time)).toBe(0);
    for (const time of [-1,NaN,Infinity]) expect(() => effectFrameAt('rain',time)).toThrow();
    expect(() => effectFrameName('bus',4)).toThrow(); expect(() => effectFrameName('shortage',0.1)).toThrow();
    expect(() => effectFrameAt('__proto__' as EffectClip,0)).toThrow();
  });

  it('authors distinct, frozen integer-pixel poses with transparent source borders', () => {
    const allFrames = new Set<string>();
    for (const clip of clips) {
      const poses = new Set<string>();
      for (let index = 0; index < EFFECT_CLIPS[clip].frames; index++) {
        const specs = effectRects(clip,index), pixels = rasterEffect(clip,index);
        expect(Object.isFrozen(specs)).toBe(true);
        expect(specs.every(rect => Object.isFrozen(rect) && [rect.x,rect.y,rect.w,rect.h].every(Number.isInteger))).toBe(true);
        expect(specs.every(rect => rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0 && rect.x + rect.w <= 32 && rect.y + rect.h <= 32)).toBe(true);
        let paintedPixels = 0;
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
          const alpha = pixels[(y * 32 + x) * 4 + 3];
          expect(alpha === 0 || alpha === 255).toBe(true);
          if (x === 0 || x === 31 || y === 0 || y === 31) expect(alpha).toBe(0);
          if (alpha) paintedPixels++;
        }
        expect(paintedPixels).toBeGreaterThan(20); expect(paintedPixels).toBeLessThan(700);
        const hash = digest(pixels); poses.add(hash); allFrames.add(hash);
      }
      expect(poses.size,`${clip} must contain individually authored frames`).toBe(EFFECT_CLIPS[clip].frames);
    }
    expect(allFrames.size).toBe(25);
  });

  it('exports25 complete Phaser frames with fixed origin, no overlap and exact extrusion/padding', () => {
    const assets = createEffectsAssets(), positions = new Set<string>();
    expect(Object.keys(assets.atlas.frames)).toHaveLength(25);
    expect([assets.width,assets.height]).toEqual([320,160]);
    expect(assets.manifest.origin).toEqual({x:0.5,y:1}); expect(assets.manifest.frameSize).toEqual({w:32,h:32});
    for (const clip of clips) for (let index = 0; index < EFFECT_CLIPS[clip].frames; index++) {
      const name = effectFrameName(clip,index), entry = assets.atlas.frames[name]!;
      expect(entry).toMatchObject({rotated:false,trimmed:false,pivot:{x:0.5,y:1},sourceSize:{w:32,h:32},spriteSourceSize:{x:0,y:0,w:32,h:32}});
      expect(entry.frame.w).toBe(32); expect(entry.frame.h).toBe(32);
      const {x,y} = entry.frame;
      expect(x % 40).toBe(4); expect(y % 40).toBe(4);
      expect(x + 36).toBeLessThanOrEqual(assets.width); expect(y + 36).toBeLessThanOrEqual(assets.height);
      expect(positions.has(`${x}:${y}`)).toBe(false); positions.add(`${x}:${y}`);
      expect(assets.manifest.clips[clip].frameNames[index]).toBe(name);
      expect(assets.manifest.clips[clip]).toMatchObject({...EFFECT_CLIPS[clip],durationMs:EFFECT_CLIPS[clip].frames / EFFECT_CLIPS[clip].fps * 1000});
      const source = rasterEffect(clip,index);
      let correctExtrusion = true, transparentPadding = true;
      for (let dy = -2; dy < 34; dy++) for (let dx = -2; dx < 34; dx++) {
        const from = (Math.max(0,Math.min(31,dy)) * 32 + Math.max(0,Math.min(31,dx))) * 4;
        const to = ((y + dy) * assets.width + x + dx) * 4;
        for (let channel = 0; channel < 4; channel++) if (source[from + channel] !== assets.rgba[to + channel]) correctExtrusion = false;
      }
      for (let i = -4; i < 36; i++) for (const edge of [-4,-3,34,35]) {
        if (assets.rgba[((y + edge) * assets.width + x + i) * 4 + 3]) transparentPadding = false;
        if (assets.rgba[((y + i) * assets.width + x + edge) * 4 + 3]) transparentPadding = false;
      }
      expect(correctExtrusion,name).toBe(true); expect(transparentPadding,name).toBe(true);
    }
    // Last row has one frame; every unused cell must remain transparent.
    for (let y = 120; y < 160; y++) for (let x = 40; x < 320; x++) expect(assets.rgba[(y * assets.width + x) * 4 + 3]).toBe(0);
  });

  it('encodes deterministic PNG pixels and a complete opaque review contact sheet', () => {
    const first = createEffectsAssets(), second = createEffectsAssets();
    expect(first.atlasJson).toBe(second.atlasJson); expect(first.clipsJson).toBe(second.clipsJson);
    expect(digest(first.atlasPng)).toBe(digest(second.atlasPng)); expect(digest(first.contactSheetPng)).toBe(digest(second.contactSheetPng));
    const png = decodePng(first.atlasPng), sheet = decodePng(first.contactSheetPng);
    expect([png.width,png.height]).toEqual([320,160]); expect(Buffer.from(png.rgba).equals(Buffer.from(first.rgba))).toBe(true);
    expect([sheet.width,sheet.height]).toEqual([160,280]);
    expect(sheet.rgba.every((byte,index) => index % 4 !== 3 || byte === 255)).toBe(true);
  });

  it('matches runtime copies, source provenance and review accessibility controls', async () => {
    const assets = createEffectsAssets();
    for (const directory of ['assets/atlases','apps/web/public/art']) {
      expect((await readFile(`${directory}/effects.png`)).equals(assets.atlasPng)).toBe(true);
      expect(await readFile(`${directory}/effects.json`,'utf8')).toBe(assets.atlasJson);
      expect(await readFile(`${directory}/effects-clips.json`,'utf8')).toBe(assets.clipsJson);
      expect((await readFile(`${directory}/effects-contact-sheet.png`)).equals(assets.contactSheetPng)).toBe(true);
      const provenance = JSON.parse(await readFile(`${directory}/effects-source.json`,'utf8')) as {sourceSha256:string;atlasSha256:string;nativeAsepriteSource:boolean};
      expect(provenance.sourceSha256).toBe(digest(await readFile('packages/art/src/effects.ts')));
      expect(provenance.atlasSha256).toBe(digest(assets.atlasPng)); expect(provenance.nativeAsepriteSource).toBe(false);
      const html = await readFile(`${directory}/effects-review.html`,'utf8');
      for (const control of ['prefers-reduced-motion: reduce','Replay clips','Pause','role="status"','Persistent static cue']) expect(html).toContain(control);
    }
    await checkEffectsAssets();
  });

  it('check mode never creates or repairs files, and preserves valid artifact mtimes', async () => {
    const root = await mkdtemp(join(tmpdir(),'effects-art-'));
    try {
      await mkdir(join(root,'packages/art/src'),{recursive:true});
      await writeFile(join(root,'packages/art/src/effects.ts'),await readFile('packages/art/src/effects.ts'));
      await expect(checkEffectsAssets(root)).rejects.toThrow('missing');
      await expect(stat(join(root,'assets'))).rejects.toMatchObject({code:'ENOENT'});
      await exportEffectsAssets(root);
      const file = join(root,'apps/web/public/art/effects.json'), before = await stat(file);
      await checkEffectsAssets(root);
      expect((await stat(file)).mtimeMs).toBe(before.mtimeMs); expect((await stat(file)).ctimeMs).toBe(before.ctimeMs);
      await writeFile(file,'stale user content');
      await expect(checkEffectsAssets(root)).rejects.toThrow('apps/web/public/art/effects.json');
      expect(await readFile(file,'utf8')).toBe('stale user content');
      await rm(join(root,'assets/atlases/effects.png'));
      await expect(checkEffectsAssets(root)).rejects.toThrow('assets/atlases/effects.png (missing)');
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});
