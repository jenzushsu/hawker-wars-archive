/** Original project artwork. Editable rectangle source; no external images or runtime dependencies. */
export const HAWKER_SIZE = 32;
export const HAWKER_SKINS = ['green', 'blue', 'amber'] as const;
export type HawkerSkin = (typeof HAWKER_SKINS)[number];
export const HAWKER_CLIPS = {
  idle: { frames: 4, fps: 4, loop: true },
  prepare: { frames: 6, fps: 8, loop: true },
  serve: { frames: 6, fps: 10, loop: false },
  waiting: { frames: 4, fps: 4, loop: true },
  shortage: { frames: 4, fps: 6, loop: false },
  celebrate: { frames: 8, fps: 10, loop: false },
} as const;
export type HawkerClip = keyof typeof HAWKER_CLIPS;
export interface PixelRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: number }
export const HAWKER_PALETTES = {
  green: { apron: 0x537858, dark: 0x35543e, light: 0x8ca77b, skin: 0xd7a779, shade: 0xa97752, hair: 0x403c32 },
  blue: { apron: 0x527e95, dark: 0x345869, light: 0x91b1b4, skin: 0xb68159, shade: 0x8f6245, hair: 0x363931 },
  amber: { apron: 0xba8b42, dark: 0x87642e, light: 0xd7b674, skin: 0xe0b787, shade: 0xaf8259, hair: 0x514536 },
} as const;

/** Stable atlas keys; bounds mistakes are rejected rather than wrapped silently. */
export function hawkerFrameName(skin: HawkerSkin, clip: HawkerClip, index: number): string {
  if (!HAWKER_SKINS.includes(skin) || !(clip in HAWKER_CLIPS) || !Number.isInteger(index) || index < 0 || index >= HAWKER_CLIPS[clip].frames) throw new RangeError('Invalid hawker frame');
  return `hawker/${skin}/${clip}/${index}`;
}
export function hawkerFrameAt(clip: HawkerClip, elapsedMs: number): number {
  if (!(clip in HAWKER_CLIPS) || !Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Invalid hawker animation time');
  const spec = HAWKER_CLIPS[clip];
  const frame = Math.floor(elapsedMs * spec.fps / 1000);
  return spec.loop ? frame % spec.frames : Math.min(frame, spec.frames - 1);
}

type Point = readonly [number, number];
interface Pose { bob: number; look: number; left: Point; right: Point; leftElbow: Point; rightElbow: Point; blink?: boolean; mouth?: 'smile' | 'oh' | 'flat'; prop?: 'cleaver' | 'plate' | 'towel'; spark?: number }
// Hands and elbows are individually authored: the fixed feet never slide between clips.
const POSES: Record<HawkerClip, readonly Pose[]> = {
  idle: [
    { bob: 0, look: 0, left: [9, 24], right: [23, 24], leftElbow: [8, 20], rightElbow: [24, 20] },
    { bob: 0, look: 0, left: [9, 23], right: [23, 23], leftElbow: [8, 19], rightElbow: [24, 19] },
    { bob: 1, look: 0, left: [9, 24], right: [23, 24], leftElbow: [8, 20], rightElbow: [24, 20], blink: true },
    { bob: 0, look: 1, left: [10, 24], right: [23, 24], leftElbow: [8, 20], rightElbow: [24, 20] },
  ],
  prepare: [
    { bob: 0, look: 1, left: [13, 24], right: [25, 20], leftElbow: [8, 21], rightElbow: [23, 17], prop: 'cleaver' },
    { bob: 0, look: 1, left: [13, 24], right: [25, 16], leftElbow: [8, 21], rightElbow: [24, 17], prop: 'cleaver' },
    { bob: 0, look: 1, left: [14, 24], right: [25, 12], leftElbow: [9, 21], rightElbow: [24, 17], prop: 'cleaver' },
    { bob: 1, look: 1, left: [14, 25], right: [26, 23], leftElbow: [9, 22], rightElbow: [24, 20], prop: 'cleaver' },
    { bob: 1, look: 1, left: [13, 25], right: [25, 24], leftElbow: [8, 22], rightElbow: [24, 21], prop: 'cleaver' },
    { bob: 0, look: 1, left: [13, 24], right: [25, 22], leftElbow: [8, 21], rightElbow: [23, 19], prop: 'cleaver' },
  ],
  serve: [
    { bob: 0, look: 1, left: [14, 23], right: [23, 23], leftElbow: [9, 21], rightElbow: [24, 20], prop: 'plate', mouth: 'smile' },
    { bob: 0, look: 1, left: [17, 23], right: [25, 23], leftElbow: [10, 21], rightElbow: [24, 21], prop: 'plate', mouth: 'smile' },
    { bob: 1, look: 1, left: [20, 24], right: [27, 24], leftElbow: [11, 22], rightElbow: [24, 22], prop: 'plate', mouth: 'smile' },
    { bob: 1, look: 1, left: [21, 24], right: [27, 24], leftElbow: [12, 22], rightElbow: [24, 22], mouth: 'smile' },
    { bob: 0, look: 1, left: [14, 24], right: [25, 23], leftElbow: [9, 21], rightElbow: [24, 21], mouth: 'smile' },
    { bob: 0, look: 0, left: [9, 24], right: [23, 24], leftElbow: [8, 20], rightElbow: [24, 20], mouth: 'smile' },
  ],
  waiting: [
    { bob: 0, look: -1, left: [15, 23], right: [17, 23], leftElbow: [8, 21], rightElbow: [24, 21], prop: 'towel' },
    { bob: 0, look: 0, left: [16, 23], right: [18, 23], leftElbow: [8, 21], rightElbow: [24, 21], prop: 'towel' },
    { bob: 1, look: 1, left: [15, 24], right: [17, 24], leftElbow: [8, 22], rightElbow: [24, 22], prop: 'towel' },
    { bob: 0, look: 0, left: [14, 23], right: [18, 23], leftElbow: [8, 21], rightElbow: [24, 21], blink: true, prop: 'towel' },
  ],
  shortage: [
    { bob: 0, look: 0, left: [7, 22], right: [25, 22], leftElbow: [8, 20], rightElbow: [24, 20], mouth: 'flat' },
    { bob: 1, look: -1, left: [5, 19], right: [27, 19], leftElbow: [8, 21], rightElbow: [24, 21], mouth: 'oh' },
    { bob: 0, look: 1, left: [5, 17], right: [27, 17], leftElbow: [8, 20], rightElbow: [24, 20], mouth: 'oh' },
    { bob: 0, look: 0, left: [6, 18], right: [26, 18], leftElbow: [8, 20], rightElbow: [24, 20], mouth: 'flat' },
  ],
  celebrate: [
    { bob: 0, look: 0, left: [8, 22], right: [24, 22], leftElbow: [8, 20], rightElbow: [24, 20], mouth: 'smile' },
    { bob: 0, look: 0, left: [5, 16], right: [27, 16], leftElbow: [8, 19], rightElbow: [24, 19], mouth: 'smile' },
    { bob: -1, look: 0, left: [5, 10], right: [27, 10], leftElbow: [8, 16], rightElbow: [24, 16], mouth: 'smile', spark: 0 },
    { bob: -1, look: 0, left: [6, 6], right: [26, 6], leftElbow: [8, 13], rightElbow: [24, 13], mouth: 'smile', spark: 1 },
    { bob: 0, look: 0, left: [5, 8], right: [27, 8], leftElbow: [8, 15], rightElbow: [24, 15], mouth: 'smile', spark: 2 },
    { bob: -1, look: 0, left: [6, 6], right: [26, 6], leftElbow: [8, 13], rightElbow: [24, 13], mouth: 'smile', spark: 3 },
    { bob: 0, look: 0, left: [5, 14], right: [27, 14], leftElbow: [8, 18], rightElbow: [24, 18], mouth: 'smile' },
    { bob: 0, look: 0, left: [9, 24], right: [23, 24], leftElbow: [8, 20], rightElbow: [24, 20], mouth: 'smile' },
  ],
};

/** Ordered opaque rectangles on a transparent 32px canvas. Feet end at y30 in every pose. */
export function hawkerRects(skin: HawkerSkin, clip: HawkerClip, index: number): readonly PixelRect[] {
  hawkerFrameName(skin, clip, index);
  const p = HAWKER_PALETTES[skin];
  const pose = POSES[clip][index]!;
  const out: PixelRect[] = [];
  const r = (color: number, x: number, y: number, w: number, h: number) => out.push({ color, x, y, w, h });
  const outline = 0x443f34, cream = 0xf4edd1, clothShade = 0xd7d4b8;
  const line = (color: number, a: Point, b: Point, width: number) => {
    const steps = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), 1);
    for (let i = 0; i <= steps; i++) r(color, Math.round(a[0] + (b[0] - a[0]) * i / steps) - Math.floor(width / 2), Math.round(a[1] + (b[1] - a[1]) * i / steps) - Math.floor(width / 2), width, width);
  };
  const arm = (shoulder: Point, elbow: Point, hand: Point) => {
    line(outline, shoulder, elbow, 5); line(clothShade, shoulder, elbow, 3);
    line(outline, elbow, hand, 4); line(p.skin, elbow, hand, 2);
    r(p.skin, hand[0] - 1, hand[1] - 1, 3, 3); r(p.shade, hand[0] - 1, hand[1] + 1, 3, 1);
  };
  // Constant ground contact: rounded dark shoes and straight work trousers.
  r(outline, 11, 25, 10, 5); r(0x596052, 12, 25, 3, 4); r(0x596052, 17, 25, 3, 4);
  r(outline, 10, 29, 6, 2); r(outline, 17, 29, 6, 2); r(0x787665, 11, 29, 3, 1); r(0x787665, 18, 29, 3, 1);
  arm([11, 17 + pose.bob], pose.leftElbow, pose.left);
  arm([21, 17 + pose.bob], pose.rightElbow, pose.right);
  // Jacket, tied apron and a single warm highlight retain the Arena's original palette.
  r(outline, 10, 15 + pose.bob, 12, 12); r(cream, 11, 15 + pose.bob, 10, 10);
  r(p.apron, 13, 16 + pose.bob, 6, 11); r(p.dark, 13, 25 + pose.bob, 6, 2);
  r(p.light, 13, 16 + pose.bob, 1, 7); r(p.dark, 14, 22 + pose.bob, 4, 3); r(p.light, 14, 22 + pose.bob, 4, 1);
  r(cream, 14, 15 + pose.bob, 1, 4); r(0xbcae8e, 20, 18 + pose.bob, 1, 5);
  r(p.shade, 14, 13 + pose.bob, 4, 3);
  const hy = pose.bob;
  r(outline, 10, 6 + hy, 12, 9); r(p.hair, 11, 6 + hy, 10, 5);
  r(p.skin, 11, 8 + hy, 10, 6); r(p.skin, 10, 10 + hy, 1, 3); r(p.skin, 21, 10 + hy, 1, 3);
  r(p.shade, 12, 13 + hy, 8, 2); r(0xeac497, 12, 8 + hy, 3, 1);
  r(p.hair, 11, 7 + hy, 2, 3); r(p.hair, 20, 7 + hy, 1, 3);
  const eyeY = 10 + hy;
  r(outline, 13 + pose.look, eyeY, pose.blink ? 2 : 1, 1); r(outline, 18 + pose.look, eyeY, pose.blink ? 2 : 1, 1);
  r(p.shade, 16 + pose.look, 11 + hy, 1, 1);
  if (pose.mouth === 'smile') { r(outline, 14, 12 + hy, 1, 1); r(outline, 18, 12 + hy, 1, 1); r(outline, 15, 13 + hy, 3, 1); }
  else if (pose.mouth === 'oh') r(outline, 16, 12 + hy, 2, 2);
  else r(outline, 15, 13 + hy, pose.mouth === 'flat' ? 4 : 2, 1);
  // A compact toque with a folded brim rather than a generic round head.
  r(outline, 9, 4 + hy, 14, 4); r(cream, 10, 4 + hy, 12, 3);
  r(outline, 11, 2 + hy, 10, 3); r(cream, 12, 2 + hy, 8, 4);
  r(0xfff6dc, 12, 2 + hy, 3, 2); r(clothShade, 10, 6 + hy, 12, 1); r(clothShade, 19, 3 + hy, 1, 2);
  // Props sit over the hands; active preparation has a moving broad cleaver.
  if (pose.prop === 'cleaver') {
    const [x, y] = pose.right;
    r(outline, x, y - 5, 1, 7); r(0xb7c3b8, x + 1, y - 6, 3, 4); r(0xe1e6d2, x + 1, y - 6, 3, 1); r(0x788b83, x + 3, y - 5, 1, 3);
  }
  if (pose.prop === 'plate') {
    const x = pose.right[0] - 5, y = pose.right[1] - 2;
    r(outline, x - 1, y + 1, 9, 2); r(0xe1e6d2, x - 1, y, 9, 2); r(0xfff1c9, x + 1, y - 2, 4, 2);
    r(0xc39354, x + 4, y - 1, 3, 1); r(0x6d8953, x, y - 1, 1, 1);
  }
  if (pose.prop === 'towel') { r(cream, 14, 23 + pose.bob, 5, 4); r(clothShade, 15, 24 + pose.bob, 1, 3); r(p.light, 18, 23 + pose.bob, 1, 3); }
  if (pose.spark !== undefined) {
    const x = pose.spark % 2 === 0 ? 3 : 28, y = pose.spark < 2 ? 3 : 11;
    r(0xe2bc65, x, y, 1, 3); r(0xffe9a0, x - 1, y + 1, 3, 1);
  }
  return Object.freeze(out.map(rect => Object.freeze(rect)));
}
