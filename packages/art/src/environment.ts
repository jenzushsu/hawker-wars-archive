/** Original hawker-centre geometry extracted from Arena.tsx; browser-independent editable rectangle art. */
export const ENVIRONMENT_SIZE = Object.freeze({ width: 480, height: 240 });
export const ENVIRONMENT_LAYERS = ['background', 'counters', 'foreground'] as const;
export type EnvironmentLayer = (typeof ENVIRONMENT_LAYERS)[number];
export interface EnvironmentRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: number; readonly alpha: number }
interface Ink { commands: EnvironmentRect[] }
export const ENVIRONMENT_LAYOUT = Object.freeze({
  stallOrigins: Object.freeze([20, 176, 332]),
  hawkerAnchors: Object.freeze([{ x: 78, y: 112 }, { x: 234, y: 112 }, { x: 390, y: 112 }].map(anchor => Object.freeze(anchor))),
  tableAnchors: Object.freeze([{ x: 77, y: 202 }, { x: 240, y: 204 }, { x: 397, y: 202 }].map(anchor => Object.freeze(anchor))),
  seatedCustomerAnchors: Object.freeze([{ x: 55, feetY: 207, variant: 1 }, { x: 222, feetY: 204, variant: 5 }, { x: 405, feetY: 209, variant: 3 }].map(anchor => Object.freeze(anchor))),
});
const WIDTH = 480;
const HEIGHT = 240;
export const ENVIRONMENT_PALETTE = {
  outline: 0x443f34,
  deepWood: 0x594639,
  wood: 0x8e6b4b,
  woodLight: 0xb18b5e,
  cream: 0xf0e1bf,
  brightCream: 0xfff1c9,
  wall: 0xd9cfb2,
  floor: 0xd3c39d,
  floorLight: 0xdecfac,
  grout: 0xbba982,
  steel: 0xb7c3b8,
  steelDark: 0x788b83,
  steelLight: 0xe1e6d2,
  terracotta: 0xb06c4a,
  terracottaDark: 0x8e523a,
  leaf: 0x42664a,
  leafLight: 0x6d8953,
};
export const ENVIRONMENT_STALLS = [
  {
    x: 20,
    accent: 0x537858,
    dark: 0x35543e,
    light: 0x8ca77b,
    skin: 0xd7a779,
    hair: 0x403c32,
  },
  {
    x: 176,
    accent: 0x527e95,
    dark: 0x345869,
    light: 0x91b1b4,
    skin: 0xb68159,
    hair: 0x363931,
  },
  {
    x: 332,
    accent: 0xba8b42,
    dark: 0x87642e,
    light: 0xd7b674,
    skin: 0xe0b787,
    hair: 0x514536,
  },
] as const;

Object.freeze(ENVIRONMENT_PALETTE);
for (const stall of ENVIRONMENT_STALLS) Object.freeze(stall);
Object.freeze(ENVIRONMENT_STALLS);
Object.freeze(ENVIRONMENT_LAYERS);
const COLORS = ENVIRONMENT_PALETTE;
const STALLS = ENVIRONMENT_STALLS;

/** Match the original Graphics rounding, with canvas clipping made explicit. */
function rect(g: Ink, color: number, x: number, y: number, width: number, height: number, alpha = 1): void {
  const left = Math.max(0, Math.round(x)), top = Math.max(0, Math.round(y));
  const right = Math.min(WIDTH, Math.round(x) + Math.round(width));
  const bottom = Math.min(HEIGHT, Math.round(y) + Math.round(height));
  if (right <= left || bottom <= top) return;
  g.commands.push({ color, x: left, y: top, w: right - left, h: bottom - top, alpha });
}
function panel(
  g: Ink,
  x: number,
  y: number,
  width: number,
  height: number,
  color: number,
  edge = COLORS.outline,
) {
  rect(g, edge, x, y, width, height);
  rect(g, color, x + 1, y + 1, width - 2, height - 2);
}
function plate(g: Ink, x: number, y: number) {
  rect(g, COLORS.steelDark, x - 6, y, 12, 3);
  rect(g, COLORS.brightCream, x - 6, y - 1, 12, 2);
  rect(g, 0xd9c38c, x - 3, y - 3, 5, 3);
  rect(g, 0xb77f45, x + 1, y - 2, 4, 2);
  rect(g, 0x6c8a4c, x - 4, y - 2, 2, 1);
}

const LETTERS: Record<string, readonly string[]> = {
  C: ["111", "100", "100", "100", "111"],
  H: ["101", "101", "111", "101", "101"],
  I: ["111", "010", "010", "010", "111"],
  K: ["101", "101", "110", "101", "101"],
  E: ["111", "100", "110", "100", "111"],
  N: ["101", "111", "111", "111", "101"],
  R: ["110", "101", "110", "101", "101"],
  O: ["111", "101", "101", "101", "111"],
  A: ["010", "101", "111", "101", "101"],
  S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"],
  M: ["101", "111", "111", "101", "101"],
};
function lettering(g: Ink, text: string, x: number, y: number, color: number) {
  for (const [index, character] of [...text].entries()) {
    const glyph = LETTERS[character];
    if (!glyph) continue;
    for (const [row, values] of glyph.entries())
      for (const [column, value] of [...values].entries()) {
        if (value === "1")
          rect(g, color, x + index * 4 + column, y + row, 1, 1);
      }
  }
}

function drawArchitecture(g: Ink) {
  rect(g, COLORS.wall, 0, 0, WIDTH, HEIGHT);
  // A shared pitched roof and exposed beams make this one centre, not three UI cards.
  rect(g, COLORS.terracottaDark, 0, 0, WIDTH, 22);
  for (let y = 0; y < 22; y += 6)
    for (let x = -8; x < WIDTH; x += 16) {
      const offset = (y / 6) % 2 ? 8 : 0;
      rect(g, COLORS.terracotta, x + offset, y, 14, 4);
      rect(g, 0xc68156, x + offset + 1, y, 12, 1);
      rect(g, 0x98583b, x + offset + 1, y + 4, 12, 1);
    }
  rect(g, COLORS.deepWood, 0, 22, WIDTH, 4);
  rect(g, COLORS.woodLight, 0, 22, WIDTH, 1);
  rect(g, 0xc5b99a, 0, 26, WIDTH, 94);
  for (let x = 0; x < WIDTH; x += 16) {
    rect(g, 0xd4c8a9, x + 1, 28, 14, 83);
    rect(g, 0xb9ac8e, x, 28, 1, 85);
  }
  rect(g, COLORS.deepWood, 0, 116, WIDTH, 6);
  rect(g, COLORS.floor, 0, 122, WIDTH, 118);
  for (let y = 122; y < HEIGHT; y += 16)
    for (let x = -8; x < WIDTH; x += 16) {
      const offset = (Math.floor((y - 122) / 16) % 2) * 8;
      rect(
        g,
        ((x + y) / 8) % 3 === 0 ? COLORS.floorLight : 0xd6c69f,
        x + offset + 1,
        y + 1,
        15,
        15,
      );
      rect(g, COLORS.grout, x + offset, y, 16, 1);
      rect(g, 0xb8aa88, x + offset, y, 1, 16);
      rect(g, 0xe2d4b1, x + offset + 2, y + 2, 12, 1);
    }
  // Recesses and practical pipework, with warm overhead tubes.
  for (const x of [8, 164, 320, 472]) {
    rect(g, COLORS.deepWood, x, 26, 4, 104);
    rect(g, COLORS.wood, x, 26, 1, 101);
    rect(g, 0x9c9d85, x + 5, 30, 2, 79);
    rect(g, 0xc7c4a7, x + 6, 30, 1, 78);
  }
  for (const x of [86, 240, 394]) {
    rect(g, COLORS.outline, x, 25, 1, 4);
    rect(g, COLORS.deepWood, x - 17, 29, 34, 4);
    rect(g, 0xdec38b, x - 15, 32, 30, 3);
    rect(g, COLORS.brightCream, x - 13, 31, 26, 2);
    rect(g, 0xf0d69e, x - 18, 35, 36, 1, 0.55);
  }
  for (const [i, stall] of STALLS.entries()) drawStallBack(g, stall, i);
}

function drawChicken(g: Ink, x: number, y: number, steamed = false) {
  const meat = steamed ? 0xe8c88e : 0xbf7e3e;
  rect(g, COLORS.steelDark, x + 3, y - 4, 1, 5);
  rect(g, COLORS.steelLight, x + 2, y - 4, 2, 1);
  rect(g, 0x805532, x + 1, y + 1, 6, 9);
  rect(g, meat, x, y + 1, 7, 7);
  rect(g, meat, x + 2, y - 1, 3, 2);
  rect(g, steamed ? 0xf5dfac : 0xe0a35e, x + 1, y + 1, 4, 2);
  rect(g, meat, x - 1, y + 6, 2, 4);
  rect(g, meat, x + 6, y + 6, 2, 4);
  rect(g, 0x986638, x + 2, y + 7, 3, 1);
}
function drawCooker(g: Ink, x: number, y: number) {
  rect(g, COLORS.outline, x - 10, y + 1, 20, 14);
  rect(g, COLORS.steel, x - 9, y + 2, 18, 10);
  rect(g, COLORS.steelLight, x - 8, y + 2, 12, 2);
  rect(g, COLORS.steelDark, x - 8, y + 10, 16, 2);
  rect(g, COLORS.deepWood, x - 11, y - 1, 22, 3);
  rect(g, COLORS.steelLight, x - 9, y - 1, 18, 1);
  rect(g, COLORS.outline, x - 2, y - 3, 4, 2);
  rect(g, 0x6b755f, x - 4, y + 6, 8, 4);
  rect(g, 0xe1aa55, x - 2, y + 7, 2, 1);
  rect(g, COLORS.outline, x - 13, y + 4, 3, 5);
  rect(g, COLORS.outline, x + 10, y + 4, 3, 5);
}
function drawStallBack(g: Ink, stall: (typeof STALLS)[number], index: number) {
  const x = stall.x;
  // Broad shallow shadow, tiled splashback, inset service opening.
  rect(g, 0xb0a183, x - 3, 48, 134, 89);
  panel(g, x, 48, 128, 66, 0xe1d4af, COLORS.deepWood);
  for (let yy = 64; yy < 110; yy += 8)
    for (let xx = x + 1; xx < x + 126; xx += 8) {
      rect(g, 0xc5c3a4, xx, yy, 7, 7);
      rect(g, 0xd5d1b0, xx + 1, yy, 6, 1);
    }
  rect(g, stall.dark, x - 3, 37, 134, 13);
  rect(g, stall.accent, x - 4, 34, 136, 9);
  rect(g, stall.light, x - 4, 34, 136, 2);
  for (let stripe = 0; stripe < 17; stripe++) {
    const xx = x - 4 + stripe * 8;
    rect(g, stripe % 2 ? stall.accent : 0xe5d8ae, xx, 40, 8, 7);
    rect(g, stripe % 2 ? stall.dark : 0xc8bd97, xx, 46, 8, 2);
  }
  panel(g, x + 34, 51, 88, 12, COLORS.cream, stall.dark);
  lettering(g, "CHICKEN RICE", x + 53, 54, stall.dark);
  // Small menu board, hand-written order lines and food illustrations.
  panel(g, x + 5, 54, 24, 31, 0x4c5141, COLORS.deepWood);
  lettering(g, index === 1 ? "STEAM" : "ROAST", x + 7, 57, 0xe7d9ac);
  for (let row = 0; row < 3; row++) {
    rect(g, 0xd4c399, x + 8, 66 + row * 5, 10 + (row % 2) * 3, 1);
    rect(g, 0xd1a85e, x + 22, 66 + row * 5, 3, 1);
  }
  rect(g, COLORS.steelDark, x + 81, 69, 35, 2);
  for (let bird = 0; bird < 3; bird++)
    drawChicken(g, x + 84 + bird * 10, 76, index === 1);
  // A glass food case, with highlights kept to crisp, one-pixel clusters.
  rect(g, 0x8fa99b, x + 79, 68, 2, 35);
  rect(g, COLORS.steelLight, x + 80, 68, 38, 1);
  rect(g, 0x8fa99b, x + 117, 68, 2, 35);
  rect(g, 0xd6e2c9, x + 82, 87, 34, 14, 0.36);
  rect(g, 0xedf0d5, x + 83, 70, 1, 27);
  rect(g, 0xedf0d5, x + 113, 73, 1, 18);
  rect(g, COLORS.steelDark, x + 80, 100, 38, 3);
  drawCooker(g, x + 20, 91);
  rect(g, COLORS.outline, x + 3, 89, 8, 2);
  rect(g, 0xc88d58, x + 4, 85, 6, 4);
  // Sauces, bowls, ladles and a tea towel give each workstation its scale.
  for (const xx of [x + 36, x + 41]) {
    rect(g, 0x654c37, xx, 94, 3, 9);
    rect(g, 0xd3b179, xx, 94, 3, 3);
    rect(g, COLORS.outline, xx + 1, 92, 1, 2);
  }
  rect(g, COLORS.steelLight, x + 71, 96, 5, 7);
  rect(g, COLORS.steelDark, x + 73, 90, 1, 7);
}

function drawCounterFront(g: Ink) {
  for (const stall of STALLS) {
    const x = stall.x;
    rect(g, 0xb3a17f, x - 2, 132, 133, 5, 0.8);
    rect(g, COLORS.deepWood, x - 3, 107, 134, 29);
    rect(g, COLORS.steelDark, x - 4, 104, 136, 8);
    rect(g, COLORS.steelLight, x - 4, 104, 136, 2);
    rect(g, COLORS.steel, x - 3, 108, 134, 3);
    rect(g, stall.accent, x + 1, 113, 126, 18);
    for (let xx = x + 1; xx < x + 127; xx += 8) {
      rect(g, stall.dark, xx, 114, 1, 16);
      rect(g, stall.light, xx + 1, 114, 5, 1);
    }
    rect(g, stall.dark, x + 1, 121, 126, 1);
    rect(g, COLORS.deepWood, x - 3, 133, 134, 3);
    for (const px of [x + 50, x + 65]) plate(g, px, 104);
    rect(g, COLORS.brightCream, x + 30, 108, 9, 11);
    rect(g, 0xd6cda9, x + 33, 110, 1, 7);
    rect(g, COLORS.steelLight, x + 109, 105, 8, 1);
    rect(g, 0x708575, x + 112, 101, 4, 4);
    // One clean rice-and-plate motif, rather than provider logos invented in art.
    rect(g, 0xe7ddbc, x + 56, 116, 15, 10);
    rect(g, stall.dark, x + 59, 122, 9, 2);
    rect(g, stall.dark, x + 61, 119, 5, 3);
    rect(g, stall.light, x + 61, 117, 1, 2);
    rect(g, stall.light, x + 65, 116, 1, 3);
  }
}

function drawTable(g: Ink, x: number, y: number) {
  // Fixed communal seats and steel supports, a familiar hawker-centre detail.
  for (const dx of [-26, 25]) {
    rect(g, COLORS.steelDark, x + dx, y + 1, 3, 20);
    rect(g, 0x6c867b, x + dx - 5, y + 3, 13, 5);
    rect(g, 0x8da494, x + dx - 4, y + 3, 11, 1);
    rect(g, COLORS.steelDark, x + dx - 1, y + 19, 5, 2);
  }
  rect(g, COLORS.steelDark, x - 2, y + 7, 5, 17);
  rect(g, COLORS.steel, x - 1, y + 8, 2, 15);
  rect(g, COLORS.steelDark, x - 12, y + 23, 25, 2);
  rect(g, 0xa69a7a, x - 21, y + 8, 45, 3, 0.7);
  rect(g, COLORS.outline, x - 20, y - 1, 40, 11);
  rect(g, COLORS.outline, x - 24, y + 2, 48, 5);
  rect(g, 0xe2d5aa, x - 21, y, 42, 8);
  rect(g, 0xeee4c4, x - 22, y + 2, 44, 4);
  rect(g, 0xf6eccd, x - 17, y, 34, 2);
  plate(g, x - 9, y + 2);
  rect(g, 0x74634b, x + 11, y - 3, 4, 5);
  rect(g, COLORS.brightCream, x + 11, y - 3, 4, 1);
  rect(g, COLORS.deepWood, x + 9, y - 1, 2, 3);
  rect(g, 0xb9ad87, x + 2, y + 2, 5, 3);
}
function drawForeground(g: Ink) {
  drawTable(g, 77, 202);
  drawTable(g, 240, 204);
  drawTable(g, 397, 202);
  // Plant, tray-return trolley and stacked bowls frame the public walkway.
  rect(g, 0x8d6245, 5, 204, 11, 17);
  rect(g, 0xb58053, 4, 203, 13, 3);
  rect(g, COLORS.leaf, 8, 181, 3, 24);
  for (let n = 0; n < 5; n++) {
    rect(
      g,
      n % 2 ? COLORS.leaf : COLORS.leafLight,
      3 + (n % 2) * 7,
      185 + n * 3,
      8,
      3,
    );
  }
  rect(g, COLORS.steelDark, 457, 199, 18, 27);
  rect(g, COLORS.steel, 459, 202, 14, 3);
  rect(g, COLORS.steel, 459, 215, 14, 3);
  for (let n = 0; n < 3; n++) {
    rect(g, 0xddd5b1, 461, 197 - n * 2, 10, 2);
    rect(g, COLORS.brightCream, 462, 197 - n * 2, 8, 1);
  }
  rect(g, COLORS.outline, 458, 226, 3, 3);
  rect(g, COLORS.outline, 471, 226, 3, 3);
}

export function environmentFrameName(layer: EnvironmentLayer): string {
  if (!ENVIRONMENT_LAYERS.includes(layer)) throw new RangeError('Invalid environment layer');
  return `environment/${layer}`;
}
/** Ordered scene-sized layer commands. People are separate sprite assets and never recorded here. */
export function environmentRects(layer: EnvironmentLayer): readonly EnvironmentRect[] {
  environmentFrameName(layer);
  const recording: Ink = { commands: [] };
  if (layer === 'background') drawArchitecture(recording);
  else if (layer === 'counters') drawCounterFront(recording);
  else drawForeground(recording);
  return Object.freeze(recording.commands.map(command => Object.freeze(command)));
}
