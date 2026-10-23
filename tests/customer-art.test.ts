import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_CLIPS, CUSTOMER_DIRECTIONS, CUSTOMER_SKINS, CUSTOMER_SIZE,
  customerFrameAt, customerFrameName, customerRects,
  type CustomerClip,
} from '../packages/art/src/customer.js';
import {
  checkCustomerAssets, createCustomerAssets, exportCustomerAssets, rasterCustomer,
} from '../scripts/export-customer.js';

const clips = Object.keys(CUSTOMER_CLIPS) as CustomerClip[];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function decodePng(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes), parts: Buffer[] = [];
  expect([...buffer.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  let width = 0, height = 0;
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii',offset + 4,offset + 8);
    const data = buffer.subarray(offset + 8,offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); expect([...data.subarray(8)]).toEqual([8,6,0,0,0]); }
    if (type === 'IDAT') parts.push(data);
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(parts)), rgba = new Uint8Array(width * height * 4);
  expect(rows.length).toBe((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    expect(rows[y * (width * 4 + 1)]).toBe(0);
    rgba.set(rows.subarray(y * (width * 4 + 1) + 1,(y + 1) * (width * 4 + 1)),y * width * 4);
  }
  return { width, height, rgba };
}

describe('original customer artwork', () => {
  it('specifies the six clips, four directions and exact looping/one-shot timing', () => {
    expect(CUSTOMER_SIZE).toEqual({w:24,h:32});
    expect(CUSTOMER_SKINS).toEqual(['terracotta','sage','saffron','slate','rose','cream']);
    expect(CUSTOMER_DIRECTIONS).toEqual(['down','left','right','up']);
    expect(CUSTOMER_CLIPS).toEqual({
      walk:{frames:4,fps:8,loop:true},wait:{frames:2,fps:2,loop:true},impatient:{frames:2,fps:4,loop:true},
      receive:{frames:4,fps:8,loop:false},eat:{frames:4,fps:4,loop:true},depart:{frames:4,fps:8,loop:false},
    });
    for (const clip of clips) {
      const {frames,fps,loop} = CUSTOMER_CLIPS[clip], interval = 1000 / fps;
      for (let index = 0; index < frames; index++) {
        expect(customerFrameAt(clip,index * interval)).toBe(index);
        expect(customerFrameAt(clip,(index + 1) * interval - 0.001)).toBe(index);
      }
      expect(customerFrameAt(clip,frames * interval)).toBe(loop ? 0 : frames - 1);
      expect(customerFrameAt(clip,1_000_000)).toBe(loop ? Math.floor(1_000_000 * fps / 1000) % frames : frames - 1);
    }
    for (const time of [-1,NaN,Infinity]) expect(() => customerFrameAt('walk',time)).toThrow();
    expect(() => customerFrameName('sage','receive','up',4)).toThrow();
    expect(() => customerFrameName('sage','wait','down',0.5)).toThrow();
    expect(() => customerFrameAt('__proto__' as CustomerClip,0)).toThrow();
  });

  it('authors unique integer-aligned poses, transparent borders and grounded feet for every variant', () => {
    const silhouetteHashes = new Set<string>();
    for (const skin of CUSTOMER_SKINS) for (const clip of clips) for (const direction of CUSTOMER_DIRECTIONS) {
      const poses = new Set<string>();
      for (let index = 0; index < CUSTOMER_CLIPS[clip].frames; index++) {
        const specs = customerRects(skin,clip,direction,index), pixels = rasterCustomer(skin,clip,direction,index);
        expect(Object.isFrozen(specs)).toBe(true);
        expect(specs.every(rect => Object.isFrozen(rect) && [rect.x,rect.y,rect.w,rect.h].every(Number.isInteger))).toBe(true);
        expect(specs.every(rect => rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0 && rect.x + rect.w <= 24 && rect.y + rect.h <= 32)).toBe(true);
        for (let x = 0; x < 24; x++) { expect(pixels[x * 4 + 3]).toBe(0); expect(pixels[(31 * 24 + x) * 4 + 3]).toBe(0); }
        for (let y = 0; y < 32; y++) { expect(pixels[y * 24 * 4 + 3]).toBe(0); expect(pixels[(y * 24 + 23) * 4 + 3]).toBe(0); }
        expect([...pixels.slice(30 * 24 * 4,31 * 24 * 4)].filter((byte,i) => i % 4 === 3 && byte === 255).length).toBeGreaterThanOrEqual(5);
        poses.add(digest(pixels));
        if (clip === 'wait' && direction === 'down' && index === 0) silhouetteHashes.add(digest(pixels.filter((_,i) => i % 4 === 3)));
      }
      expect(poses.size,`${skin}/${clip}/${direction} must have distinct authored poses`).toBe(CUSTOMER_CLIPS[clip].frames);
    }
    // Hair, garment width and bag shapes distinguish variants in addition to palette swaps.
    expect(silhouetteHashes.size).toBeGreaterThanOrEqual(4);
  });

  it('has true front/back views and exactly mirrored side geometry with the same origin', () => {
    for (const skin of CUSTOMER_SKINS) for (const clip of clips) for (let index = 0; index < CUSTOMER_CLIPS[clip].frames; index++) {
      const left = rasterCustomer(skin,clip,'left',index), right = rasterCustomer(skin,clip,'right',index);
      const flipped = new Uint8Array(left.length);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 24; x++) {
        const from = (y * 24 + x) * 4, to = (y * 24 + 23 - x) * 4;
        flipped.set(left.subarray(from,from + 4),to);
      }
      expect(Buffer.from(right).equals(Buffer.from(flipped))).toBe(true);
      expect(digest(rasterCustomer(skin,clip,'down',index))).not.toBe(digest(rasterCustomer(skin,clip,'up',index)));
    }
  });

  it('exports all480 Phaser frames below2048px, with fixed geometry, extrusion and clear padding', () => {
    const assets = createCustomerAssets(), cells = new Set<string>();
    expect(Object.keys(assets.atlas.frames)).toHaveLength(480);
    expect([assets.width,assets.height]).toEqual([1024,600]);
    expect(assets.width).toBeLessThanOrEqual(2048); expect(assets.height).toBeLessThanOrEqual(2048);
    for (const skin of CUSTOMER_SKINS) for (const clip of clips) for (const direction of CUSTOMER_DIRECTIONS) {
      expect(assets.manifest.clips[clip]).toMatchObject({...CUSTOMER_CLIPS[clip],durationMs:CUSTOMER_CLIPS[clip].frames / CUSTOMER_CLIPS[clip].fps * 1000});
      for (let index = 0; index < CUSTOMER_CLIPS[clip].frames; index++) {
        const name = customerFrameName(skin,clip,direction,index), entry = assets.atlas.frames[name]!;
        expect(entry).toMatchObject({rotated:false,trimmed:false,pivot:{x:0.5,y:1},sourceSize:{w:24,h:32},spriteSourceSize:{x:0,y:0,w:24,h:32}});
        expect(entry.frame.w).toBe(24); expect(entry.frame.h).toBe(32);
        const {x,y} = entry.frame;
        expect(x % 32).toBe(4); expect(y % 40).toBe(4);
        expect(x + 28).toBeLessThanOrEqual(assets.width); expect(y + 36).toBeLessThanOrEqual(assets.height);
        expect(cells.has(`${x}:${y}`)).toBe(false); cells.add(`${x}:${y}`);
        expect(assets.manifest.clips[clip].frameNames[skin][direction][index]).toBe(name);
        const source = rasterCustomer(skin,clip,direction,index);
        let correctExtrusion = true, transparentPadding = true;
        for (let dy = -2; dy < 34; dy++) for (let dx = -2; dx < 26; dx++) {
          const from = (Math.max(0,Math.min(31,dy)) * 24 + Math.max(0,Math.min(23,dx))) * 4;
          const to = ((y + dy) * assets.width + x + dx) * 4;
          for (let channel = 0; channel < 4; channel++) if (source[from + channel] !== assets.rgba[to + channel]) correctExtrusion = false;
        }
        for (let dx = -4; dx < 28; dx++) for (const dy of [-4,-3,34,35]) if (assets.rgba[((y + dy) * assets.width + x + dx) * 4 + 3]) transparentPadding = false;
        for (let dy = -4; dy < 36; dy++) for (const dx of [-4,-3,26,27]) if (assets.rgba[((y + dy) * assets.width + x + dx) * 4 + 3]) transparentPadding = false;
        expect(correctExtrusion,`${name} exact extrusion`).toBe(true);
        expect(transparentPadding,`${name} transparent padding`).toBe(true);
      }
    }
  });

  it('exports deterministic decoded PNG pixels and a complete contact sheet', () => {
    const first = createCustomerAssets(), second = createCustomerAssets();
    expect(first.atlasJson).toBe(second.atlasJson); expect(first.clipsJson).toBe(second.clipsJson);
    expect(digest(first.atlasPng)).toBe(digest(second.atlasPng)); expect(digest(first.contactSheetPng)).toBe(digest(second.contactSheetPng));
    const png = decodePng(first.atlasPng), sheet = decodePng(first.contactSheetPng);
    expect([png.width,png.height]).toEqual([first.width,first.height]);
    expect(Buffer.from(png.rgba).equals(Buffer.from(first.rgba))).toBe(true);
    expect([sheet.width,sheet.height]).toEqual([512,1440]);
    expect(sheet.rgba.every((byte,index) => index % 4 !== 3 || byte === 255)).toBe(true);
  });

  it('matches checked-in artifacts, source provenance and reduced-motion review controls', async () => {
    const assets = createCustomerAssets();
    for (const directory of ['assets/atlases','apps/web/public/art']) {
      expect((await readFile(`${directory}/customer.png`)).equals(assets.atlasPng)).toBe(true);
      expect(await readFile(`${directory}/customer.json`,'utf8')).toBe(assets.atlasJson);
      expect(await readFile(`${directory}/customer-clips.json`,'utf8')).toBe(assets.clipsJson);
      expect((await readFile(`${directory}/customer-contact-sheet.png`)).equals(assets.contactSheetPng)).toBe(true);
      const provenance = JSON.parse(await readFile(`${directory}/customer-source.json`,'utf8')) as {sourceSha256:string;atlasSha256:string;nativeAsepriteSource:boolean};
      expect(provenance.sourceSha256).toBe(digest(await readFile('packages/art/src/customer.ts')));
      expect(provenance.atlasSha256).toBe(digest(assets.atlasPng)); expect(provenance.nativeAsepriteSource).toBe(false);
      const html = await readFile(`${directory}/customer-review.html`,'utf8');
      for (const control of ['prefers-reduced-motion: reduce','Replay clips','Pause','id="skin"','id="direction"']) expect(html).toContain(control);
    }
    await checkCustomerAssets();
  });

  it('check mode never creates or repairs artifacts and preserves valid file mtimes', async () => {
    const root = await mkdtemp(join(tmpdir(),'customer-art-'));
    try {
      await mkdir(join(root,'packages/art/src'),{recursive:true});
      await writeFile(join(root,'packages/art/src/customer.ts'),await readFile('packages/art/src/customer.ts'));
      await expect(checkCustomerAssets(root)).rejects.toThrow('missing');
      await expect(stat(join(root,'assets'))).rejects.toMatchObject({code:'ENOENT'});
      await exportCustomerAssets(root);
      const path = join(root,'apps/web/public/art/customer.json'), before = await stat(path);
      await checkCustomerAssets(root);
      expect((await stat(path)).mtimeMs).toBe(before.mtimeMs); expect((await stat(path)).ctimeMs).toBe(before.ctimeMs);
      await writeFile(path,'stale user content');
      await expect(checkCustomerAssets(root)).rejects.toThrow('apps/web/public/art/customer.json');
      expect(await readFile(path,'utf8')).toBe('stale user content');
      await rm(join(root,'assets/atlases/customer.png'));
      await expect(checkCustomerAssets(root)).rejects.toThrow('assets/atlases/customer.png (missing)');
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});
