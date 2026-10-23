import { UI_ATLAS_SIZE, uiAtlasFrame, type UiIconName, type UiIconSize } from '../../../packages/art/src/ui';

/** Decorative companion to adjacent visible text; the label carries the accessible meaning. */
export function Pictogram({ name, size = 16, className = '' }: { name: UiIconName; size?: UiIconSize; className?: string }) {
  const frame = uiAtlasFrame(name, size);
  return <span aria-hidden="true" className={`ui-icon ${className}`.trim()} style={{ display: 'inline-block', width: size, height: size, flex: '0 0 auto', verticalAlign: '-0.125em', backgroundImage: 'url(/art/ui.png)', backgroundSize: `${UI_ATLAS_SIZE.width}px ${UI_ATLAS_SIZE.height}px`, backgroundPosition: `-${frame.x}px -${frame.y}px`, backgroundRepeat: 'no-repeat', imageRendering: 'pixelated' }} />;
}
