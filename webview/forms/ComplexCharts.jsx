import { For, Show, createUniqueId } from 'solid-js';

/** These two native sample charts remain identical on repeated Configurator opens. */
export function Dendrogram(props) {
  const state = props.controller.state, w = () => props.width, h = () => props.height;
  const x = index => Math.round(23 + (w() - 22) * (index + .5) / 4) - .5;
  const y = value => Math.round(h() - 16 - value * (h() - 25) / 3.5) - .5;
  const left = () => Math.floor((x(0) + x(1)) / 2) - .5, right = () => Math.floor((x(2) + x(3)) / 2) - .5;
  return <svg class="taxi-dendrogram" viewBox={`0 0 ${w()} ${h()}`} aria-hidden="true">
    <path d={`M22.5 8.5V${y(0)}H${w()}`} fill="none" stroke="#a9a9a9" shape-rendering="crispEdges"/>
    <For each={[0, .5, 1, 1.5, 2, 2.5, 3, 3.5]}>{value => <text x="22" y={y(value)} text-anchor="end" dominant-baseline="middle">{new Intl.NumberFormat(state.culture).format(value)}</text>}</For>
    <path d={`M${x(0)} ${y(0)}V${y(2)}H${x(1)}V${y(0)}M${x(2)} ${y(0)}V${y(1)}H${x(3)}V${y(0)}M${left()} ${y(2)}V${y(3)}H${right()}V${y(1)}`} fill="none" stroke="#000080" shape-rendering="crispEdges"/>
    <For each={[0, 1, 2, 3]}>{index => <text class="taxi-dendrogram-label" x={x(index)} y={h() - 4} text-anchor="middle">{`<${state.strings.chartElement} ${index + 1}>`}</text>}</For>
  </svg>;
}

export function Gantt(props) {
  const state = props.controller.state, clip = createUniqueId();
  const pieces = () => state.strings.chartValue.match(/.{1,3}/gu) ?? [];
  const rowHeight = () => 22 + pieces().length * 16;
  const scroll = () => 23 + rowHeight() * 4 > props.height;
  const pointWidth = () => state.locale.toLowerCase().startsWith('ru') ? 70 : 66;
  const timeline = () => pointWidth() + 66;
  const main = () => props.width - 88 - (scroll() ? 14 : 0), step = () => (main() - timeline()) / 12;
  const row = index => 23 + index * rowHeight();
  const intervals = () => [[0, 0, 2, false], [0, 4, 9, false], [1, 1, 5, false], [3, 2, 6, false], [3, 3, 4, true]]
    .filter(([index]) => row(index) + (rowHeight() - 21) / 2 < props.height);
  return <svg class="taxi-gantt" viewBox={`0 0 ${props.width} ${props.height}`} aria-hidden="true">
    <defs><clipPath id={clip}><rect width={main()} height={props.height}/></clipPath></defs>
    <g clip-path={`url(#${clip})`}>
      <rect x="1.5" y="1.5" width={main() - 2} height="21" fill="#f2f2f2" stroke="#fff" shape-rendering="crispEdges"/>
      <path d={`M1 ${22.5}H${main()}`} stroke="#ccc" shape-rendering="crispEdges"/>
      <For each={[pointWidth(), pointWidth() + 33, timeline()]}>{x => <><path d={`M${x - .5} 1V22M${x + 1.5} 1V22`} stroke="#fff" shape-rendering="crispEdges"/><path d={`M${x}.5 1V23`} stroke="#ccc" shape-rendering="crispEdges"/></>}</For>
      <text x={pointWidth() + 8} y="15">&lt;</text><text x={pointWidth() + 41} y="15">&lt;</text>
      <For each={Array.from({ length: 12 }, (_, index) => index)}>{index => <>
        <path d={`M${Math.round(timeline() + index * step()) + .5} 1V23`} stroke="#ccc" shape-rendering="crispEdges"/>
        {index > 0 && <path d={`M${Math.round(timeline() + index * step()) + .5} 23V${props.height}`} stroke="#e6e6e6" stroke-dasharray="1 1" shape-rendering="crispEdges"/>}
        <text x={timeline() + step() * (index + .5)} y="15" text-anchor="middle">{String(index + 1).padStart(2, '0')}</text>
      </>}</For>
      <For each={[0, 1, 2, 3]}>{index => <>
        <path d={`M${pointWidth()} ${row(index) + rowHeight() - .5}H${main()}`} stroke="#e6e6e6" shape-rendering="crispEdges"/>
        <text x="4" y={row(index) + 15}>{`<${state.strings.chartPoint} ${index + 1}>`}</text>
        <For each={[pointWidth() + 4, pointWidth() + 37]}>{x => <text x={x} y={row(index) + 15}><tspan x={x}>&lt;</tspan><For each={pieces()}>{(part, partIndex) => <tspan x={x} dy="16">{part}{partIndex() === pieces().length - 1 ? '>' : ''}</tspan>}</For></text>}</For>
      </>}</For>
      <For each={intervals()}>{([rowIndex, start, end, orange]) => <rect class="taxi-gantt-interval" x={timeline() + 1.5 + start * step()} y={row(rowIndex) + (rowHeight() - 21) / 2} width={(end - start) * step()} height="21" rx="2" fill={orange ? '#f98d52' : '#5792ef'}/>}</For>
    </g>
    <Show when={scroll()}><rect x={main() + 3} y="23" width="8" height={props.height - 48} rx="4" fill="#d5d5d5"/>
    <rect x={main() + 3} y="23" width="8" height={props.height - 82} rx="4" fill="#9a9a9a"/>
    <path d={`M${main() + 4} 11l3-4 3 4zM${main() + 4} ${props.height - 14}l3 4 3-4z`} fill="#c2c2c2"/></Show>
    <Show when={!scroll()}><path d={`M${main() - .5} 1V${props.height - 1}`} stroke="#a0a0a0" shape-rendering="crispEdges"/></Show>
    <rect x={props.width - 84.5} y={props.height / 2 - 7} width="15" height="15" fill="#5792ef" stroke="#a0a0a0" shape-rendering="crispEdges"/>
    <text x={props.width - 68} y={props.height / 2 + 4}>{`<${state.strings.chartSeries} 1>`}</text>
  </svg>;
}
