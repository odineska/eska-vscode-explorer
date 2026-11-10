import { referenceButtonSlotWidth } from './model.mjs';
import { searchClearPixels } from './search-control.mjs';

function image(rows) {
  const inks = new Map();
  for (const [y, row] of rows.entries()) {
    for (const [x, gray] of row.entries()) {
      if (gray === 255) continue;
      inks.set(gray, (inks.get(gray) ?? '') + `M${x} ${y}h1v1h-1z`);
    }
  }
  const paths = [...inks].map(([gray, d]) => `<path d="${d}" fill="rgb(${gray},${gray},${gray})"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${rows[0].length}" height="${rows.length}" shape-rendering="crispEdges">${paths}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const clearRows = inactive => {
  const pixels = searchClearPixels([77, 77, 77], [255, 255, 255], inactive);
  return Array.from({ length: 7 }, (_, row) => pixels.slice(row * 7, (row + 1) * 7).map(([gray]) => gray));
};

const openRows = [
  '...xxxxxx', '...x....x', '...x....x',
  'xx.x....x', 'x..x....x', 'x..xxxxxx',
  'x........', 'x....x...', 'xxxxxx...',
];

// Offsets are measured inside the slot, after its left divider and top border.
const stencils = {
  dropdown: {
    x: 7, y: 8,
    images: [
      image([[109, 77, 77, 77, 108], [250, 89, 77, 89, 250], [255, 234, 91, 234, 255]]),
      image([[180, 164, 164, 164, 180], [252, 170, 164, 170, 252], [255, 244, 171, 244, 255]]),
    ],
  },
  choice: { x: 6, y: 13, images: [77, 164].map(gray => image([[gray, 255, 255, gray, 255, 255, gray]])) },
  clear: { x: 6, y: 6, images: [false, true].map(inactive => image(clearRows(inactive))) },
  open: {
    x: 6, y: 5,
    images: [77, 164].map(gray => image(openRows.map(row => [...row].map(pixel => pixel === 'x' ? gray : 255)))),
  },
};
const spinUp = [image([[239, 96, 241], [101, 77, 104]]), image([[247, 173, 247], [176, 164, 177]])];
const spinDown = [image([[103, 77, 100], [241, 96, 239]]), image([[177, 164, 175], [247, 173, 247]])];

function at(imageUrl, x, y) {
  return `${imageUrl} ${x}px ${y}px no-repeat`;
}

/** Shared image sources keep the repeated glyphs out of the form's DOM tree. */
export function referenceButtonBackground(kind, height, inactive) {
  const variant = Number(inactive);
  if (kind === 'spin') {
    const middle = Math.floor(height / 2);
    const border = 'var(--taxi-input-button-border, #a0a0a0)';
    return [
      at(spinUp[variant], 8, Math.max(5, Math.floor((middle - 1) / 2)) - 1),
      at(spinDown[variant], 8, Math.floor((height + middle - 4) / 2) - 1),
      `linear-gradient(${border}, ${border}) 0 ${middle - 1}px / ${referenceButtonSlotWidth - 1}px 1px no-repeat`,
    ].join(', ');
  }
  const { x, y, images } = stencils[kind];
  return at(images[variant], x, y + Math.round((height - 23) / 2));
}
