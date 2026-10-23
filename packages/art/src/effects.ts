/** Original game-effect artwork. Editable, browser-safe integer pixel rectangles. */
export const EFFECT_SIZE = 32;
export const EFFECT_CLIPS = {
  steam: { frames: 4, fps: 6, loop: true },
  service: { frames: 4, fps: 8, loop: false },
  shortage: { frames: 1, fps: 1, loop: true },
  delivery: { frames: 4, fps: 8, loop: false },
  bus: { frames: 4, fps: 8, loop: false },
  rain: { frames: 4, fps: 8, loop: true },
  'supplier-delay': { frames: 4, fps: 8, loop: true },
} as const;
export type EffectClip = keyof typeof EFFECT_CLIPS;
export interface EffectPixelRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: number }
export const EFFECT_PALETTE = {
  outline: 0x443f34, deepWood: 0x594639, wood: 0x8e6b4b, woodLight: 0xb18b5e,
  cream: 0xf0e1bf, brightCream: 0xfff1c9, cloth: 0xd7d4b8,
  steel: 0xb7c3b8, steelDark: 0x788b83, steelLight: 0xe1e6d2,
  green: 0x537858, greenDark: 0x35543e, greenLight: 0x8ca77b,
  blue: 0x527e95, blueDark: 0x345869, blueLight: 0x91b1b4,
  amber: 0xba8b42, amberLight: 0xd7b674, venueRed: 0x9a352a,
} as const;

export function effectFrameName(clip: EffectClip, index: number): string {
  if (!Object.hasOwn(EFFECT_CLIPS, clip) || !Number.isInteger(index) || index < 0 || index >= EFFECT_CLIPS[clip].frames) throw new RangeError('Invalid effect frame');
  return `effects/${clip}/${index}`;
}
/** Elapsed time is local visual time; one-shot clips clamp and persistent cues loop. */
export function effectFrameAt(clip: EffectClip, elapsedMs: number): number {
  if (!Object.hasOwn(EFFECT_CLIPS, clip) || !Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Invalid effect animation time');
  const spec = EFFECT_CLIPS[clip], frame = Math.floor(elapsedMs * spec.fps / 1000);
  return spec.loop ? frame % spec.frames : Math.min(frame, spec.frames - 1);
}

/** Fixed32px frame and bottom-centre origin. The caller owns placement, visibility and simulation state. */
export function effectRects(clip: EffectClip, index: number): readonly EffectPixelRect[] {
  effectFrameName(clip,index);
  const p = EFFECT_PALETTE, out: EffectPixelRect[] = [];
  const r = (color: number, x: number, y: number, w: number, h: number) => out.push({ color,x,y,w,h });
  const sparkle = (x: number, y: number, large: boolean) => {
    r(p.amberLight,x,y - (large ? 2 : 1),1,large ? 5 : 3);
    r(p.brightCream,x - (large ? 2 : 1),y,large ? 5 : 3,1);
    if (large) r(p.cream,x,y,1,1);
  };
  const crate = (x: number, y: number, open: boolean) => {
    r(p.outline,x,y,18,12); r(p.wood,x + 1,y + 1,16,10);
    r(p.woodLight,x + 2,y + 2,14,2); r(p.deepWood,x + 1,y + 5,16,1);
    r(p.woodLight,x + 2,y + 7,14,2); r(p.deepWood,x + 3,y + 1,2,10);
    r(p.deepWood,x + 13,y + 1,2,10); r(p.woodLight,x + 3,y + 1,1,10);
    r(p.outline,x + 7,y + 2,4,2); r(p.amberLight,x + 8,y + 2,2,1);
    if (open) { r(p.outline,x + 1,y - 2,16,3); r(p.deepWood,x + 2,y - 1,14,1); }
    else { r(p.outline,x - 1,y - 2,20,3); r(p.woodLight,x,y - 1,18,1); }
  };
  if (clip === 'steam') {
    // Three individual curling wisps rise and drift, with empty space between clusters.
    const phase = [0,1,2,1][index]!, lift = [0,2,4,1][index]!;
    r(p.cloth,8 + phase,23 - lift,2,4); r(p.steelLight,9 + phase,20 - lift,2,3);
    r(p.brightCream,8 + phase,17 - lift,2,3); r(p.cream,7 + phase,15 - lift,2,2);
    r(p.steelLight,16 - phase,26 - lift,2,3); r(p.cream,15 - phase,23 - lift,2,3);
    r(p.brightCream,16 - phase,19 - lift,2,4); r(p.cloth,17 - phase,16 - lift,2,3);
    r(p.steelLight,22 + (index % 2),24 - lift,2,3); r(p.brightCream,23,21 - lift,2,3);
    r(p.cream,22,18 - lift,2,3); r(p.cloth,21,16 - lift,2,2);
    if (index === 2) { r(p.cream,9,6,1,2); r(p.steelLight,18,8,1,2); }
    if (index === 3) r(p.cream,24,10,1,2);
  } else if (clip === 'service') {
    const y = [24,22,21,22][index]!;
    // A familiar chicken-rice plate, with a one-shot handoff glint rather than a UI badge.
    r(p.steelDark,7,y + 1,18,3); r(p.steelLight,6,y,20,2); r(p.brightCream,8,y - 1,16,2);
    r(p.amberLight,11,y - 5,7,4); r(p.brightCream,12,y - 6,5,4);
    r(0xb77f45,18,y - 4,5,3); r(0xd3a76c,19,y - 4,3,1); r(p.green,9,y - 3,2,2);
    r(p.steel,9,y + 3,14,1);
    if (index < 3) { sparkle(6 + index,12 - index,index === 1); sparkle(26 - index,15 - index,index === 2); }
    else sparkle(24,11,false);
  } else if (clip === 'shortage') {
    // Persistent, static empty serving tray. A folded red towel is a quiet operational cue.
    r(p.outline,5,19,22,8); r(p.steelDark,6,20,20,6); r(p.steelLight,7,21,18,4);
    r(p.steel,8,22,16,2); r(p.steelDark,10,22,12,1); r(p.cream,7,20,18,1);
    r(p.outline,9,27,15,2); r(p.steel,10,27,13,1);
    r(p.venueRed,22,23,4,6); r(0xb76e5a,22,23,1,5); r(p.deepWood,24,28,2,1);
    r(p.cloth,13,12,7,5); r(p.cream,14,12,5,4); r(p.deepWood,15,14,3,1);
  } else if (clip === 'delivery') {
    const y = [18,17,18,18][index]!;
    if (index >= 2) {
      // Rice sack and a bundle of greens emerge behind the opened wooden crate.
      r(p.outline,11,9,9,13); r(p.cream,12,10,7,10); r(p.cloth,13,10,1,9);
      r(p.deepWood,14,9,3,1); r(p.amber,14,14,3,2); r(p.greenDark,21,13,3,7);
      r(p.greenLight,19,11,3,5); r(p.green,22,10,2,6);
    }
    crate(7,y,index >= 2);
    if (index === 0) { r(p.amberLight,2,20,3,1); r(p.amberLight,3,19,1,3); }
    if (index === 1) { r(p.cream,3,16,2,1); r(p.cream,27,18,2,1); }
    if (index === 2) { r(p.outline,7,6,18,3); r(p.woodLight,8,7,16,1); }
    if (index === 3) { sparkle(5,11,false); sparkle(27,12,true); }
  } else if (clip === 'bus') {
    const bob = [0,1,0,-1][index]!;
    // Original compact public bus: warm ivory roof, green body and passenger windows.
    r(p.outline,3,11 + bob,25,14); r(p.outline,5,9 + bob,20,3);
    r(p.cream,5,10 + bob,20,2); r(p.green,4,12 + bob,23,12);
    r(p.blueDark,6,13 + bob,15,7); r(p.blueLight,7,14 + bob,13,4);
    r(p.blueDark,23,12 + bob,3,9); r(p.blueLight,24,13 + bob,2,5);
    r(p.cream,11,13 + bob,1,7); r(p.cream,16,13 + bob,1,7);
    r(p.outline,8,16 + bob,2,2); r(p.amberLight,8,17 + bob,2,2);
    r(p.outline,13,15 + bob + index % 2,2,2); r(0xbd8c65,13,16 + bob + index % 2,2,2);
    r(p.outline,18,16 + bob,2,2); r(p.cloth,18,17 + bob,2,2);
    r(p.greenDark,4,22 + bob,23,2); r(p.greenLight,5,21 + bob,16,1);
    r(p.amberLight,25,21 + bob,2,2); r(p.venueRed,4,21 + bob,1,2);
    r(p.outline,7,24,5,5); r(p.outline,21,24,5,5);
    r(p.steelDark,8,25,3,3); r(p.steelDark,22,25,3,3);
    r(p.steelLight,8 + index % 2,26,2,1); r(p.steelLight,22 + index % 2,26,2,1);
    // Arrival arrow moves toward the front while preserving the texture's fixed origin.
    const arrow = 9 + index * 2;
    r(p.amberLight,arrow,5,5,1); r(p.amberLight,arrow + 3,4,1,3);
    r(p.brightCream,arrow + 4,5,1,1);
  } else if (clip === 'rain') {
    r(p.steelDark,7,8,19,5); r(p.steelDark,11,5,10,5);
    r(p.steel,8,8,17,4); r(p.steel,12,6,8,4); r(p.steelLight,12,6,5,1);
    r(p.blueLight,8,12,17,1);
    for (const [n,x] of [7,15,23].entries()) {
      const y = 15 + (index * 3 + n * 4) % 10;
      r(p.blue,x,y,1,3); r(p.blueLight,x - 1,y + 2,1,2);
    }
    const spread = [0,2,3,1][index]!;
    r(p.blueLight,11 - spread,28,10 + spread * 2,1);
    r(p.steelLight,13 - spread,27,6 + spread * 2,1);
    if (index % 2) { r(p.blueLight,5,27,2,1); r(p.blueLight,25,26,2,1); }
  } else {
    // A supply crate and a small kitchen clock distinguish delay from stock shortage.
    crate(3,18,false);
    r(p.outline,17,7,9,2); r(p.outline,15,9,13,11); r(p.outline,17,20,9,2);
    r(p.cream,17,9,9,11); r(p.cream,16,11,11,7); r(p.brightCream,18,10,7,9);
    r(p.steelDark,21,9,1,2); r(p.steelDark,21,18,1,2);
    r(p.steelDark,16,14,2,1); r(p.steelDark,25,14,2,1);
    r(p.amber,20,13,2,2); r(p.deepWood,21,14,1,2);
    if (index === 0) r(p.deepWood,21,11,1,4);
    else if (index === 1) r(p.deepWood,21,14,4,1);
    else if (index === 2) r(p.deepWood,21,14,1,4);
    else r(p.deepWood,18,14,4,1);
    r(p.amberLight,20,7,3,1); r(p.woodLight,5,27,12,1);
  }
  return Object.freeze(out.map(rect => Object.freeze(rect)));
}
