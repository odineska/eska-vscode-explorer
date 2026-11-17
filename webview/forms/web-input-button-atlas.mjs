import atlas85 from '../../resources/forms/web-client-input/edtButtons_85.png';
import atlas100 from '../../resources/forms/web-client-input/edtButtons_100.png';
import atlas125 from '../../resources/forms/web-client-input/edtButtons_125.png';
import atlas150 from '../../resources/forms/web-client-input/edtButtons_150.png';
import atlas175 from '../../resources/forms/web-client-input/edtButtons_175.png';
import atlas200 from '../../resources/forms/web-client-input/edtButtons_200.png';
import atlas300 from '../../resources/forms/web-client-input/edtButtons_300.png';
import atlas400 from '../../resources/forms/web-client-input/edtButtons_400.png';

const roles = ['calculator', 'calendar', 'spin-down', 'spin-up', 'open', 'dropdown', 'clear', 'choice'];

// The bounds are the nontransparent pixels within each tile, in atlas order.
const atlases = [
  [85, atlas85, 14, [[2, 2, 11, 13], [2, 3, 11, 13], [5, 6, 8, 8], [5, 8, 8, 10], [3, 3, 12, 12], [4, 6, 9, 9], [3, 4, 10, 11], [3, 11, 10, 12]]],
  [100, atlas100, 16, [[3, 2, 12, 13], [3, 2, 12, 12], [6, 6, 9, 8], [6, 7, 9, 9], [4, 3, 13, 12], [5, 6, 10, 9], [4, 4, 11, 11], [4, 11, 11, 12]]],
  [125, atlas125, 20, [[4, 3, 16, 17], [4, 3, 16, 16], [8, 8, 12, 11], [8, 9, 12, 12], [4, 4, 16, 16], [6, 8, 14, 12], [6, 6, 14, 14], [5, 14, 15, 16]]],
  [150, atlas150, 24, [[5, 3, 19, 20], [5, 3, 19, 19], [9, 9, 14, 13], [9, 10, 14, 14], [5, 4, 20, 19], [7, 9, 16, 14], [7, 7, 16, 16], [5, 15, 18, 18]]],
  [175, atlas175, 28, [[6, 4, 22, 24], [6, 4, 22, 22], [11, 11, 17, 15], [11, 13, 17, 17], [6, 6, 22, 22], [9, 11, 19, 17], [9, 9, 19, 19], [7, 20, 21, 22]]],
  [200, atlas200, 32, [[7, 5, 25, 27], [7, 5, 25, 25], [13, 13, 19, 17], [13, 15, 19, 19], [7, 7, 25, 25], [11, 13, 21, 19], [10, 10, 22, 22], [9, 23, 23, 25]]],
  [300, atlas300, 48, [[11, 8, 38, 41], [11, 8, 38, 38], [20, 20, 29, 26], [20, 23, 29, 29], [11, 11, 38, 38], [17, 20, 32, 29], [15, 16, 34, 33], [14, 35, 35, 38]]],
  [400, atlas400, 64, [[14, 9, 50, 53], [14, 10, 50, 50], [25, 26, 40, 36], [24, 26, 39, 36], [13, 12, 51, 50], [22, 24, 43, 38], [20, 19, 44, 43], [18, 45, 46, 49]]],
];

export function webInputButtonAtlas(zoom, pixelRatio) {
  const scaled = zoom * pixelRatio;
  if (zoom === 100 || !Number.isFinite(scaled) || scaled <= 0) return;
  // The web client compares relative scale, giving larger variants a small bias.
  let atlas = atlases[0], distance = Infinity;
  for (const variant of atlases) {
    const [scale] = variant;
    const relative = scale < scaled ? scaled / scale : scale / scaled - 0.01;
    if (relative < distance) {
      atlas = variant;
      distance = relative;
    }
  }
  return { density: scaled / 100, atlas };
}

export function webInputButtonTile({ density, atlas }, role, centerX, centerY, slotWidth, slotHeight) {
  const [, source, size, bounds] = atlas;
  const index = roles.indexOf(role);
  const [left, top, right, bottom] = bounds[index];
  const width = right - left, height = bottom - top;
  const availableWidth = Math.max(1, Math.floor(slotWidth * density));
  const availableHeight = Math.max(1, Math.floor(slotHeight * density));
  // Keep whole pixels when the ink fits. Shrink the tile only to avoid clipping.
  const fit = Math.min(1, availableWidth / width, availableHeight / height);
  const tileSize = size * fit / density;
  const origin = (center, start, ink, available) => {
    const ideal = Math.round(center * density - ink * fit / 2);
    const end = Math.floor(available - ink * fit);
    return (Math.max(0, Math.min(end, ideal)) - start * fit) / density;
  };
  return {
    left: `${origin(centerX, left, width, availableWidth)}px`,
    top: `${origin(centerY, top, height, availableHeight)}px`,
    width: `${tileSize}px`,
    height: `${tileSize}px`,
    background: `url("${source}") ${-index * tileSize}px 0 / ${tileSize * 9}px ${tileSize}px no-repeat`,
  };
}
