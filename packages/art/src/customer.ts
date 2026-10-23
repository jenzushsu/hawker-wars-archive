/** Original customer pixel artwork. Browser-safe editable rectangles, without image or engine dependencies. */
export const CUSTOMER_SIZE = { w: 24, h: 32 } as const;
export const CUSTOMER_SKINS = ['terracotta', 'sage', 'saffron', 'slate', 'rose', 'cream'] as const;
export const CUSTOMER_DIRECTIONS = ['down', 'left', 'right', 'up'] as const;
export type CustomerSkin = (typeof CUSTOMER_SKINS)[number];
export type CustomerDirection = (typeof CUSTOMER_DIRECTIONS)[number];
export const CUSTOMER_CLIPS = {
  walk: { frames: 4, fps: 8, loop: true },
  wait: { frames: 2, fps: 2, loop: true },
  impatient: { frames: 2, fps: 4, loop: true },
  receive: { frames: 4, fps: 8, loop: false },
  eat: { frames: 4, fps: 4, loop: true },
  depart: { frames: 4, fps: 8, loop: false },
} as const;
export type CustomerClip = keyof typeof CUSTOMER_CLIPS;
export interface CustomerPixelRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: number }
// The six PEOPLE palettes from the original Arena; silhouettes add hair, collars and bags.
export const CUSTOMER_PALETTES = {
  terracotta: { skin: 0xd6ab80, shade: 0xa77e58, shirt: 0x9c684f, dark: 0x684c40, light: 0xb88463, hair: 0x393a32, trousers: 0x555d51 },
  sage: { skin: 0xa87550, shade: 0x81573f, shirt: 0x709180, dark: 0x456b5e, light: 0x91aa94, hair: 0x30372f, trousers: 0x555650 },
  saffron: { skin: 0xe6be91, shade: 0xb28b63, shirt: 0xd2ac65, dark: 0x9e7e48, light: 0xe4c68b, hair: 0x5e4c37, trousers: 0x606a6c },
  slate: { skin: 0xbd8c65, shade: 0x936849, shirt: 0x6d819d, dark: 0x4a607a, light: 0x91a1b5, hair: 0x3b3733, trousers: 0x665a4e },
  rose: { skin: 0xe0ae83, shade: 0xad7e59, shirt: 0xc18d84, dark: 0x925c59, light: 0xd6aaa0, hair: 0x413b32, trousers: 0x5b6858 },
  cream: { skin: 0x916649, shade: 0x6f4e39, shirt: 0xc6c4a3, dark: 0x939376, light: 0xdedbc0, hair: 0x30372e, trousers: 0x4f5d62 },
} as const;

export function customerFrameName(skin: CustomerSkin, clip: CustomerClip, direction: CustomerDirection, index: number): string {
  if (!CUSTOMER_SKINS.includes(skin) || !Object.hasOwn(CUSTOMER_CLIPS, clip) || !CUSTOMER_DIRECTIONS.includes(direction) || !Number.isInteger(index) || index < 0 || index >= CUSTOMER_CLIPS[clip].frames) throw new RangeError('Invalid customer frame');
  return `customer/${skin}/${clip}/${direction}/${index}`;
}
export function customerFrameAt(clip: CustomerClip, elapsedMs: number): number {
  if (!Object.hasOwn(CUSTOMER_CLIPS, clip) || !Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Invalid customer animation time');
  const spec = CUSTOMER_CLIPS[clip], frame = Math.floor(elapsedMs * spec.fps / 1000);
  return spec.loop ? frame % spec.frames : Math.min(frame, spec.frames - 1);
}

type Point = readonly [number, number];
interface Pose { bob: number; stride: number; swing: number; left: Point; right: Point; blink: boolean; look: number; plate: boolean; spoon: boolean; wave: boolean }
function poseAt(clip: CustomerClip, frame: number): Pose {
  const pose: Pose = { bob: 0, stride: 0, swing: 0, left: [6,22], right: [18,22], blink: false, look: 0, plate: false, spoon: false, wave: false };
  if (clip === 'walk' || clip === 'depart') {
    pose.stride = [0,2,0,-2][frame]!; pose.swing = [-1,2,1,-2][frame]!; pose.bob = frame % 2;
    pose.left = [6 - (frame === 1 ? 1 : 0),22 + pose.swing]; pose.right = [18,22 - pose.swing];
    if (clip === 'depart') { pose.look = frame < 2 ? -1 : 0; pose.wave = frame < 2; if (pose.wave) pose.right = [19,13 - frame * 2]; }
  } else if (clip === 'wait') {
    pose.bob = frame; pose.blink = frame === 1; pose.left = [9,23 + frame]; pose.right = [15,23 + frame];
  } else if (clip === 'impatient') {
    pose.look = frame === 0 ? -1 : 1; pose.left = [10,19 + frame]; pose.right = [15,19 + frame]; pose.stride = frame; pose.bob = frame;
  } else if (clip === 'receive') {
    pose.left = ([[7,22],[7,21],[8,21],[9,22]] as const)[frame]!;
    pose.right = ([[19,22],[20,20],[20,20],[16,22]] as const)[frame]!;
    pose.look = frame < 3 ? 1 : 0; pose.bob = frame === 2 ? 1 : 0; pose.plate = frame >= 2;
  } else {
    pose.left = [8,22]; pose.right = ([[18,21],[16,16],[15,13],[18,19]] as const)[frame]!;
    pose.bob = frame === 3 ? 1 : 0; pose.blink = frame === 2; pose.plate = true; pose.spoon = true;
  }
  return pose;
}

/** Opaque, integer-aligned source rectangles on a transparent24×32 frame; feet never leave the frame. */
export function customerRects(skin: CustomerSkin, clip: CustomerClip, direction: CustomerDirection, frame: number): readonly CustomerPixelRect[] {
  customerFrameName(skin,clip,direction,frame);
  const p = CUSTOMER_PALETTES[skin], pose = poseAt(clip,frame), out: CustomerPixelRect[] = [];
  const side = direction === 'left' || direction === 'right', back = direction === 'up', mirror = direction === 'right';
  const outline = 0x443f34, cream = 0xf0e1bf, steel = 0xb7c3b8, steelLight = 0xe1e6d2;
  const r = (color: number, x: number, y: number, w: number, h: number) => out.push({ color, x: mirror ? CUSTOMER_SIZE.w - x - w : x, y, w, h });
  const line = (color: number, from: Point, to: Point, width: number) => {
    const steps = Math.max(Math.abs(to[0] - from[0]),Math.abs(to[1] - from[1]),1);
    for (let i = 0; i <= steps; i++) r(color,Math.round(from[0] + (to[0] - from[0]) * i / steps) - Math.floor(width / 2),Math.round(from[1] + (to[1] - from[1]) * i / steps) - Math.floor(width / 2),width,width);
  };
  const arm = (shoulder: Point, hand: Point) => {
    const elbow: Point = [Math.round((shoulder[0] + hand[0]) / 2),Math.round((shoulder[1] + hand[1]) / 2)];
    line(outline,shoulder,elbow,4); line(p.shirt,shoulder,elbow,2);
    line(outline,elbow,hand,3); line(p.skin,elbow,hand,1); r(p.skin,hand[0] - 1,hand[1] - 1,3,3); r(p.shade,hand[0] - 1,hand[1] + 1,3,1);
  };
  const plate = (x: number, y: number) => {
    r(outline,x - 4,y + 1,9,2); r(steelLight,x - 4,y,9,2); r(0xfff1c9,x - 2,y - 2,4,2);
    r(0xb77f45,x + 1,y - 1,3,1); r(0x6c8a4c,x - 3,y - 1,1,1);
  };
  const bob = pose.bob;
  // Alternating knees/heels convey movement without translating the source origin.
  if (side) {
    const backFoot = 12 - pose.stride, frontFoot = 11 + pose.stride;
    r(outline,11,23,4,6); r(p.dark,12,24,2,4); r(outline,backFoot - 1,28,5,2);
    r(outline,9,23,4,6); r(p.trousers,10,24,2,5); r(outline,frontFoot - 2,29,6,2); r(0x79796b,frontFoot - 1,29,3,1);
  } else {
    r(outline,8,23,4,7); r(outline,13,23,4,7); r(p.trousers,9,24,2,5); r(p.trousers,14,24,2,5);
    r(outline,7 - Math.sign(pose.stride),29 - (pose.stride < 0 ? 1 : 0),5,2);
    r(outline,13 + Math.sign(pose.stride),29 - (pose.stride > 0 ? 1 : 0),5,2);
    r(0x79796b,8 - Math.sign(pose.stride),29 - (pose.stride < 0 ? 1 : 0),2,1);
    r(0x79796b,14 + Math.sign(pose.stride),29 - (pose.stride > 0 ? 1 : 0),2,1);
  }
  if (side) {
    // Far arm/body first; the near hand and prop are added in front after the face.
    arm([13,16 + bob],[14,22 - pose.swing]);
    r(outline,8,14 + bob,8,11); r(p.shirt,9,15 + bob,6,9); r(p.dark,14,16 + bob,1,8); r(p.light,9,16 + bob,1,6);
    if (skin === 'sage' || skin === 'rose') { r(outline,14,20 + bob,4,6); r(skin === 'rose' ? cream : p.dark,15,21 + bob,2,4); }
    if (skin === 'slate') { r(outline,14,15 + bob,4,8); r(p.dark,15,16 + bob,2,6); r(p.light,15,16 + bob,1,4); }
    r(p.shade,10,12 + bob,3,3);
    r(outline,8,4 + bob,8,9); r(p.hair,9,4 + bob,6,8); r(p.skin,8,7 + bob,5,6);
    r(p.skin,7,9 + bob,2,2); r(p.shade,8,12 + bob,4,1); r(p.skin,13,8 + bob,2,3);
    r(p.hair,9,5 + bob,6,3); r(p.hair,13,7 + bob,2,5);
    if (skin === 'sage') { r(p.hair,15,5 + bob,2,4); r(p.light,15,8 + bob,1,1); }
    if (skin === 'rose') r(p.hair,13,8 + bob,3,6);
    if (skin === 'saffron') { r(outline,8,8 + bob,3,2); r(0xb4b4a2,9,8 + bob,1,1); r(0x8b7961,10,4 + bob,3,1); }
    else { r(outline,8,9 + bob,pose.blink ? 2 : 1,1); }
    if (skin === 'cream') r(p.hair,8,11 + bob,2,1);
    if (skin === 'terracotta') { r(p.light,9,15 + bob,3,1); r(cream,13,16 + bob,1,3); }
    let hand: Point = [9 - Math.max(0,pose.swing),22 + pose.swing];
    if (clip === 'wait') hand = [8,23 + frame];
    if (clip === 'impatient') hand = [6 + frame,18 + frame];
    if (clip === 'receive') hand = ([[7,22],[4,20],[4,20],[7,22]] as const)[frame]!;
    if (clip === 'eat') hand = ([[7,21],[6,17],[7,13],[7,19]] as const)[frame]!;
    if (pose.wave) hand = [7,12 - frame * 2];
    arm([10,17 + bob],hand);
    if (pose.plate) plate(6,clip === 'eat' ? 23 : hand[1] - 1);
    if (pose.spoon) { r(steel,hand[0] - 1,hand[1] - 3,1,4); r(steelLight,hand[0] - 2,hand[1] - 4,2,2); }
    if (clip === 'impatient') { r(outline,6 + frame,18 + frame,3,2); r(steelLight,7 + frame,18 + frame,1,1); }
  } else {
    arm([8,16 + bob],pose.left); arm([16,16 + bob],pose.right);
    const wide = skin === 'cream' ? 1 : 0;
    r(outline,7 - wide,14 + bob,10 + wide * 2,11); r(p.shirt,8 - wide,15 + bob,8 + wide * 2,9); r(p.dark,8 - wide,23 + bob,8 + wide * 2,1);
    r(p.light,8,16 + bob,1,6); r(p.dark,15 + wide,16 + bob,1,7);
    if (!back) {
      r(p.shade,10,12 + bob,4,3); r(cream,10,14 + bob,2,2); r(cream,13,14 + bob,1,2);
      if (skin === 'terracotta') { r(cream,12,17 + bob,1,1); r(cream,12,20 + bob,1,1); }
      if (skin === 'saffron') { r(p.light,9,18 + bob,6,1); r(p.light,9,21 + bob,6,1); }
      if (skin === 'slate') { r(p.dark,9,15 + bob,1,7); r(p.dark,14,15 + bob,1,7); }
      if (skin === 'sage' || skin === 'rose') {
        line(cream,[8,15 + bob],[16,23 + bob],1); r(outline,16,21 + bob,3,5); r(skin === 'rose' ? cream : p.dark,17,22 + bob,1,3);
      }
    } else {
      r(p.light,9,15 + bob,6,1);
      if (skin === 'slate') { r(outline,8,16 + bob,8,8); r(p.dark,9,17 + bob,6,6); r(p.light,10,18 + bob,4,1); r(p.light,10,21 + bob,4,1); }
      if (skin === 'sage' || skin === 'rose') line(cream,[8,15 + bob],[16,23 + bob],1);
    }
    r(outline,7,4 + bob,10,9); r(p.hair,8,4 + bob,8,8);
    if (!back) {
      r(p.skin,8,7 + bob,8,6); r(p.skin,7,8 + bob,1,3); r(p.skin,16,8 + bob,1,3); r(p.shade,9,12 + bob,6,1);
      r(p.hair,8,5 + bob,8,2); r(p.hair,8,7 + bob,1,2); r(p.hair,15,7 + bob,1,2);
      if (skin === 'saffron') { r(outline,8,8 + bob,3,2); r(outline,13,8 + bob,3,2); r(outline,11,8 + bob,2,1); r(0xb4b4a2,9,8 + bob,1,1); r(0xb4b4a2,14,8 + bob,1,1); }
      else { r(outline,9 + pose.look,9 + bob,pose.blink ? 2 : 1,1); r(outline,14 + pose.look,9 + bob,pose.blink ? 2 : 1,1); }
      r(p.shade,12,10 + bob,1,1); r(outline,11,11 + bob,clip === 'impatient' ? 3 : 2,1);
      if (skin === 'cream') r(p.hair,10,10 + bob,4,1);
    } else { r(p.hair,8,7 + bob,8,5); r(p.dark,9,5 + bob,5,1); }
    if (skin === 'sage') { r(p.hair,10,2 + bob,4,3); r(p.light,11,4 + bob,2,1); }
    if (skin === 'rose') { r(p.hair,7,8 + bob,2,6); r(p.hair,15,8 + bob,2,6); }
    if (skin === 'saffron') { r(0x8b7961,9,3 + bob,2,1); r(p.hair,8,3 + bob,1,2); r(p.hair,15,3 + bob,1,2); }
    if (skin === 'slate') { r(p.hair,9,3 + bob,7,2); r(0x625446,13,4 + bob,2,1); }
    if (skin === 'cream') r(0x55594a,9,4 + bob,6,1);
    // Repaint hands crossing the torso so folded arms and handoff reads survive at native size.
    if (clip === 'wait' || clip === 'impatient' || clip === 'receive' || clip === 'eat') {
      arm([8,16 + bob],pose.left); arm([16,16 + bob],pose.right);
    }
    if (pose.plate) plate(clip === 'eat' ? 11 : Math.min(18,pose.right[0] - 1),clip === 'eat' ? 23 : pose.right[1] - 1);
    if (pose.spoon) { const [x,y] = pose.right; r(steel,x,y - 3,1,4); r(steelLight,x - 1,y - 4,2,2); }
    if (clip === 'impatient') { r(outline,10,18 + frame,3,2); r(steelLight,11,18 + frame,1,1); }
  }
  return Object.freeze(out.map(rect => Object.freeze(rect)));
}
