import { Show } from 'solid-js';

const positions = ['left top', 'right top', 'left bottom', 'right bottom'];

export function inputCornerBackground(corners) {
  return corners.map((pixels, index) => {
    const cells = pixels.map((pixel, position) =>
      `<rect x="${position % 3}" y="${Math.floor(position / 3)}" width="1" height="1" fill="rgb(${pixel.join(',')})"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3" height="3" shape-rendering="crispEdges">${cells}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${positions[index]} no-repeat`;
  }).join(', ');
}

export function NativeInputCorners(props) {
  // Choice inputs extend one pixel; search controls allocate their complete width.
  const right = () => props.rightOffset ?? (props.paint.outset ? '-2px' : '-1px');
  return <Show when={props.paint}>{paint =>
    <span class="taxi-input-corner" aria-hidden="true" style={{
      right: right(), background: paint().cornerBackground ?? inputCornerBackground(paint().corners),
    }}/>}</Show>;
}
