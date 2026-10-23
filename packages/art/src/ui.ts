/** Original editable pixel pictograms; integer rectangles, no external icon library or imagery. */
export const UI_ICON_NAMES = Object.freeze(['inventory', 'queue', 'time', 'latency', 'warning', 'validation', 'vote', 'sound', 'expand'] as const);
export const UI_ICON_SIZES = Object.freeze([16, 24] as const);
export type UiIconName = (typeof UI_ICON_NAMES)[number];
export type UiIconSize = (typeof UI_ICON_SIZES)[number];
export interface UiRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly color: number }
export const UI_PALETTE = Object.freeze({ ink: 0x443f34, paper: 0xf0e1bf, wood: 0xb18b5e, green: 0x42664a, terracotta: 0xb06c4a });
export const UI_ATLAS_SIZE = Object.freeze({ width: 288, height: 64 });
function validate(name: UiIconName, size: UiIconSize): void {
  if (!UI_ICON_NAMES.includes(name) || !UI_ICON_SIZES.includes(size)) throw new Error('Unknown UI pictogram or size');
}
export function uiFrameName(name: UiIconName, size: UiIconSize): string { validate(name, size); return `ui/${name}/${size}`; }
/** Shared with the DOM consumer; every 32px cell leaves room for two-pixel extrusion and padding. */
export function uiAtlasFrame(name: UiIconName, size: UiIconSize) {
  validate(name, size);
  const inset = (32 - size) / 2;
  return Object.freeze({ x: UI_ICON_NAMES.indexOf(name) * 32 + inset, y: (size === 16 ? 0 : 32) + inset, w: size, h: size });
}
/** 24px art snaps the same authored silhouette to a larger integer grid; never interpolates bitmap pixels. */
export function uiRects(name: UiIconName, size: UiIconSize): readonly UiRect[] {
  validate(name, size);
  const commands: UiRect[] = [], p = UI_PALETTE;
  const rect = (color: number, x: number, y: number, w: number, h: number) => {
    const left = Math.round(x * size / 16), top = Math.round(y * size / 16);
    commands.push(Object.freeze({ color, x: left, y: top, w: Math.round((x + w) * size / 16) - left, h: Math.round((y + h) * size / 16) - top }));
  };
  const panel = (x: number, y: number, w: number, h: number, fill: number) => { rect(p.ink, x, y, w, h); rect(fill, x + 1, y + 1, w - 2, h - 2); };
  switch (name) {
    case 'inventory':
      panel(3, 6, 10, 8, p.wood); panel(2, 4, 12, 4, p.paper);
      rect(p.ink, 6, 8, 1, 5); rect(p.ink, 9, 8, 1, 5); break;
    case 'queue':
      for (const x of [2, 7, 12]) { rect(p.ink, x, 3, 3, 3); rect(p.paper, x + 1, 4, 1, 1); rect(p.ink, x - 1, 7, 4, 6); rect(p.wood, x, 8, 2, 4); }
      break;
    case 'time':
      rect(p.ink, 5, 1, 6, 2); rect(p.ink, 3, 3, 10, 2); rect(p.ink, 1, 5, 14, 6); rect(p.ink, 3, 11, 10, 2); rect(p.ink, 5, 13, 6, 2);
      rect(p.paper, 5, 3, 6, 10); rect(p.paper, 3, 5, 10, 6); rect(p.ink, 7, 4, 2, 5); rect(p.ink, 8, 8, 4, 2); break;
    case 'latency':
      rect(p.ink, 8, 1, 5, 3); rect(p.ink, 6, 4, 5, 3); rect(p.ink, 4, 7, 10, 3); rect(p.ink, 7, 10, 5, 3); rect(p.ink, 5, 13, 4, 2);
      rect(p.wood, 9, 2, 2, 2); rect(p.wood, 7, 4, 2, 4); rect(p.wood, 6, 8, 6, 1); rect(p.wood, 8, 9, 2, 3); rect(p.wood, 7, 12, 2, 1); break;
    case 'warning':
      for (let y = 2; y <= 12; y += 2) rect(p.ink, 7 - (y - 2) / 2, y, 2 + y - 2, 2);
      rect(p.ink, 1, 13, 14, 2);
      for (let y = 4; y <= 12; y += 2) rect(p.terracotta, 8 - (y - 2) / 2, y, y - 2, 2);
      rect(p.paper, 7, 5, 2, 5); rect(p.paper, 7, 11, 2, 2); break;
    case 'validation':
      rect(p.ink, 1, 7, 4, 4); rect(p.ink, 3, 9, 4, 4); rect(p.ink, 5, 11, 4, 3);
      for (let i = 0; i < 5; i++) rect(p.ink, 6 + i, 10 - i * 2, 4, 4);
      rect(p.green, 2, 8, 2, 2); rect(p.green, 4, 10, 2, 2); rect(p.green, 6, 11, 2, 2);
      for (let i = 0; i < 5; i++) rect(p.green, 7 + i, 10 - i * 2, 2, 2); break;
    case 'vote':
      panel(2, 8, 12, 6, p.wood); rect(p.ink, 5, 9, 6, 1); panel(5, 1, 6, 9, p.paper);
      rect(p.green, 6, 5, 2, 2); rect(p.green, 8, 3, 2, 3); break;
    case 'sound':
      rect(p.ink, 2, 6, 4, 5); rect(p.ink, 5, 4, 2, 9); rect(p.ink, 7, 2, 2, 13);
      rect(p.wood, 3, 7, 3, 3); rect(p.wood, 6, 5, 2, 7);
      rect(p.ink, 10, 5, 2, 7); rect(p.ink, 12, 3, 2, 2); rect(p.ink, 13, 5, 2, 7); rect(p.ink, 12, 12, 2, 2); break;
    case 'expand':
      for (const [x, y, right, bottom] of [[2, 2, false, false], [9, 2, true, false], [2, 9, false, true], [9, 9, true, true]] as const) {
        rect(p.ink, x, y + (bottom ? 3 : 0), 5, 2); rect(p.ink, x + (right ? 3 : 0), y, 2, 5);
      }
      break;
  }
  return Object.freeze(commands);
}
