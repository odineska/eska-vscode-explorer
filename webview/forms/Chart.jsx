import { For } from 'solid-js';

// The Configurator supplies fresh sample values on each open. Their values are excluded
// from parity comparison; layout, series order, palette and labels remain profile-owned.
const values = [[10, 19, 13, 12.5], [12, 12.5, 6, 2], [16.5, 1.7, 11, 20], [5, 11.5, 1, 12.5]];
const palette = ['#4cc8ff', '#ff8779', '#ffc000', '#5fc26e'];

export function Chart(props) {
  const state = props.controller.state;
  const width = () => props.width, height = () => props.height;
  const plot = () => ({ x: 22, y: 8, width: Math.max(100, width() - 114), height: Math.max(60, height() - 32) });
  return <svg class="taxi-chart" width="100%" height="100%" viewBox={`0 0 ${width()} ${height()}`} aria-hidden="true">
    <For each={[0, 5, 10, 15, 20]}>{tick => <>
      <path d={`M${plot().x - 4} ${plot().y + plot().height * (1 - tick / 20)}h${plot().width + 4}`} stroke={tick === 0 ? '#aaa' : '#ddd'} stroke-width="1" shape-rendering="crispEdges"/>
      <text x={plot().x - 7} y={plot().y + plot().height * (1 - tick / 20)} text-anchor="end" dominant-baseline="middle">{tick}</text>
    </>}</For>
    <path d={`M${plot().x} ${plot().y}v${plot().height}`} fill="none" stroke="#aaa" shape-rendering="crispEdges"/>
    <For each={values}>{(point, index) => <>
      <For each={point}>{(value, series) => <rect x={plot().x + plot().width / 4 * (index() + 1 / 6 + series() / 6)} y={plot().y + plot().height * (1 - value / 20)}
        width={plot().width / 24} height={plot().height * value / 20} fill={palette[series()]}/>}</For>
      <text x={plot().x + plot().width / 4 * (index() + .5)} y={height() - 4} text-anchor="middle">{`<${state.strings.chartPoint} ${index() + 1}>`}</text>
    </>}</For>
    <For each={palette}>{(color, index) => <g transform={`translate(${width() - 90} ${(height() - 68) / 2 + index() * 17})`}>
      <rect width="14" height="14" fill={color}/><text x="17" y="7" dominant-baseline="middle">{`<${state.strings.chartSeries} ${index() + 1}>`}</text>
    </g>}</For>
  </svg>;
}
