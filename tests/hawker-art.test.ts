import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { HAWKER_CLIPS, HAWKER_SKINS, hawkerFrameAt, hawkerFrameName, hawkerRects, type HawkerClip } from '../packages/art/src/hawker.js';
import { checkHawkerAssets, createHawkerAssets, exportHawkerAssets, rasterHawker } from '../scripts/export-hawker.js';

const clips = Object.keys(HAWKER_CLIPS) as HawkerClip[];
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function decodePng(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes), compressed: Buffer[] = [];
  expect([...buffer.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  let width = 0, height = 0;
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii',offset + 4,offset + 8), data = buffer.subarray(offset + 8,offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); expect([...data.subarray(8)]).toEqual([8,6,0,0,0]); }
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(compressed)), rgba = new Uint8Array(width * height * 4);
  expect(rows.length).toBe((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    expect(rows[y * (width * 4 + 1)]).toBe(0);
    rgba.set(rows.subarray(y * (width * 4 + 1) + 1,(y + 1) * (width * 4 + 1)),y * width * 4);
  }
  return { width,height,rgba };
}

describe('original hawker sprite contract', () => {
  it('has the six specified clips and honours loop/clamp cadence boundaries', () => {
    expect(HAWKER_CLIPS).toEqual({ idle:{frames:4,fps:4,loop:true},prepare:{frames:6,fps:8,loop:true},serve:{frames:6,fps:10,loop:false},waiting:{frames:4,fps:4,loop:true},shortage:{frames:4,fps:6,loop:false},celebrate:{frames:8,fps:10,loop:false} });
    for (const clip of clips) {
      const spec = HAWKER_CLIPS[clip], interval = 1000 / spec.fps;
      for (let frame = 0; frame < spec.frames; frame++) {
        expect(hawkerFrameAt(clip,frame * interval + 0.001)).toBe(frame);
        expect(hawkerFrameAt(clip,(frame + 1) * interval - 0.001)).toBe(frame);
      }
      expect(hawkerFrameAt(clip,spec.frames * interval + 0.001)).toBe(spec.loop ? 0 : spec.frames - 1);
      expect(hawkerFrameAt(clip,1_000_000)).toBe(spec.loop ? Math.floor(1_000_000 * spec.fps / 1000) % spec.frames : spec.frames - 1);
    }
    for (const time of [-1,NaN,Infinity]) expect(() => hawkerFrameAt('idle',time)).toThrow();
    expect(() => hawkerFrameName('green','prepare',6)).toThrow();
    expect(() => hawkerFrameName('green','idle',0.5)).toThrow();
  });

  it('authors distinct poses in every clip, with integer pixels, transparent borders and fixed feet', () => {
    const referenceFeet = rasterHawker('green','idle',0).slice(29 * 32 * 4,31 * 32 * 4);
    for (const skin of HAWKER_SKINS) for (const clip of clips) {
      const frameHashes = new Set<string>();
      for (let index = 0; index < HAWKER_CLIPS[clip].frames; index++) {
        const specs = hawkerRects(skin,clip,index), rgba = rasterHawker(skin,clip,index);
        expect(Object.isFrozen(specs)).toBe(true);
        for (const rect of specs) expect([rect.x,rect.y,rect.w,rect.h].every(Number.isInteger)).toBe(true);
        frameHashes.add(digest(rgba));
        expect(rgba.slice(29 * 32 * 4,31 * 32 * 4)).toEqual(referenceFeet);
        for (let axis = 0; axis < 32; axis++) {
          for (const pixel of [axis,31 * 32 + axis,axis * 32,axis * 32 + 31]) expect(rgba[pixel * 4 + 3]).toBe(0);
        }
      }
      expect(frameHashes.size).toBe(HAWKER_CLIPS[clip].frames);
    }
    expect(digest(rasterHawker('green','idle',0))).not.toBe(digest(rasterHawker('blue','idle',0)));
    expect(digest(rasterHawker('blue','idle',0))).not.toBe(digest(rasterHawker('amber','idle',0)));
  });

  it('exports 96 Phaser frames without trimming, rotation, overlap or pivot drift', () => {
    const assets = createHawkerAssets(), names = Object.keys(assets.atlas.frames), cells = new Set<string>();
    expect(names).toHaveLength(96); expect(assets.width).toBe(640); expect(assets.height).toBe(240);
    for (const skin of HAWKER_SKINS) for (const clip of clips) for (let index = 0; index < HAWKER_CLIPS[clip].frames; index++) {
      const name = hawkerFrameName(skin,clip,index), entry = assets.atlas.frames[name]!;
      expect(entry).toMatchObject({ rotated:false,trimmed:false,pivot:{x:0.5,y:1},sourceSize:{w:32,h:32},spriteSourceSize:{x:0,y:0,w:32,h:32} });
      expect(entry.frame.w).toBe(32); expect(entry.frame.h).toBe(32);
      const {x,y} = entry.frame;
      expect(x % 40).toBe(4); expect(y % 40).toBe(4);
      expect(x + 36).toBeLessThanOrEqual(assets.width); expect(y + 36).toBeLessThanOrEqual(assets.height);
      expect(cells.has(`${x}:${y}`)).toBe(false); cells.add(`${x}:${y}`);
      const source = rasterHawker(skin,clip,index);
      for (let dy = -2; dy < 34; dy++) for (let dx = -2; dx < 34; dx++) {
        const from = (Math.max(0,Math.min(31,dy)) * 32 + Math.max(0,Math.min(31,dx))) * 4;
        const to = ((y + dy) * assets.width + x + dx) * 4;
        expect(assets.rgba.subarray(to,to + 4)).toEqual(source.subarray(from,from + 4));
      }
      // The outer two pixels of every40px cell are transparent padding.
      for (let i = 0; i < 40; i++) for (const inset of [0,1,38,39]) {
        expect(assets.rgba[((y - 4 + inset) * assets.width + x - 4 + i) * 4 + 3]).toBe(0);
        expect(assets.rgba[((y - 4 + i) * assets.width + x - 4 + inset) * 4 + 3]).toBe(0);
      }
      expect(assets.manifest.clips[clip].frameNames[skin][index]).toBe(name);
    }
  });

  it('encodes deterministic PNG pixels and an independently parseable contact sheet', () => {
    const one = createHawkerAssets(), two = createHawkerAssets();
    expect(one.atlasJson).toBe(two.atlasJson); expect(one.clipsJson).toBe(two.clipsJson);
    expect(digest(one.atlasPng)).toBe(digest(two.atlasPng)); expect(digest(one.contactSheetPng)).toBe(digest(two.contactSheetPng));
    const decoded = decodePng(one.atlasPng);
    expect(decoded.width).toBe(one.width); expect(decoded.height).toBe(one.height); expect(decoded.rgba).toEqual(one.rgba);
    const sheet = decodePng(one.contactSheetPng);
    expect(sheet.width).toBe(320); expect(sheet.height).toBe(720);
    expect([...sheet.rgba.filter((_, index) => index % 4 === 3)].every(alpha => alpha === 255)).toBe(true);
  });

  it('keeps checked-in runtime and review artifacts equal to the editable source export', async () => {
    const generated = createHawkerAssets();
    for (const directory of ['assets/atlases','apps/web/public/art']) {
      expect(await readFile(`${directory}/hawker.png`)).toEqual(generated.atlasPng);
      expect(await readFile(`${directory}/hawker.json`,'utf8')).toBe(generated.atlasJson);
      expect(await readFile(`${directory}/hawker-clips.json`,'utf8')).toBe(generated.clipsJson);
      expect(await readFile(`${directory}/hawker-contact-sheet.png`)).toEqual(generated.contactSheetPng);
      const provenance = JSON.parse(await readFile(`${directory}/hawker-source.json`,'utf8')) as {sourceSha256:string;atlasSha256:string;nativeAsepriteSource:boolean};
      expect(provenance.sourceSha256).toBe(digest(await readFile('packages/art/src/hawker.ts')));
      expect(provenance.atlasSha256).toBe(digest(generated.atlasPng)); expect(provenance.nativeAsepriteSource).toBe(false);
      const html = await readFile(`${directory}/hawker-review.html`,'utf8');
      expect(html).toContain('prefers-reduced-motion: reduce'); expect(html).toContain('Replay clips');
    }
  });

  it('check mode does not create or overwrite files, and rejects stale or missing artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(),'hawker-art-'));
    try {
      await mkdir(join(root,'packages/art/src'),{recursive:true});
      await writeFile(join(root,'packages/art/src/hawker.ts'),await readFile('packages/art/src/hawker.ts'));
      await expect(checkHawkerAssets(root)).rejects.toThrow('missing');
      await expect(stat(join(root,'assets'))).rejects.toMatchObject({code:'ENOENT'});
      await exportHawkerAssets(root);
      const file = join(root,'apps/web/public/art/hawker.json'), before = await stat(file);
      await checkHawkerAssets(root);
      const after = await stat(file);
      expect(after.mtimeMs).toBe(before.mtimeMs); expect(after.ctimeMs).toBe(before.ctimeMs);
      await writeFile(file,'stale user content');
      await expect(checkHawkerAssets(root)).rejects.toThrow('apps/web/public/art/hawker.json');
      expect(await readFile(file,'utf8')).toBe('stale user content');
      await rm(join(root,'assets/atlases/hawker.png'));
      await expect(checkHawkerAssets(root)).rejects.toThrow('assets/atlases/hawker.png (missing)');
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});
