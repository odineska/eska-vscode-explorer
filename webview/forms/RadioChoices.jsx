import { For, Show, createMemo } from 'solid-js';
import { buttonMetrics, caption, color, flag, font, fontLineMetrics, number, scalar, text } from './model.mjs';
import { hintedTextWidth } from './font-metrics.mjs';
import { NativeLabel } from './NativeLabel.jsx';

function linuxFont(value) {
  const css = font(value, 'linux');
  const { pixels } = fontLineMetrics(value);
  return { ...css, 'font-size': `${pixels}px` };
}

export function radioCaptionWidth(text, value) {
  const style = linuxFont(value);
  return hintedTextWidth(text, {
    family: /^"([^"]+)",/.exec(style['font-family'])?.[1],
    pixels: parseFloat(style['font-size']),
    weight: style['font-weight'],
    italic: style['font-style'] === 'italic',
  });
}

export function RadioChoices(props) {
  const node = () => props.node, state = props.controller.state;
  const linux = state.os === 'linux';
  const valueFont = () => node().presentation.font;
  const foreground = () => node().presentation.foreground;
  const enabled = () => flag(node(), 'Enabled');
  const segments = () => scalar(node(), 'RadioButtonType') === 'Tumbler';
  const fallback = [1, 2, 3].map(value => ({ kind: 'name', text: state.strings.sampleValue.replace('{0}', value) }));
  const choices = () => node().presentation.choices.length ? node().presentation.choices : fallback;
  const columns = () => Math.min(choices().length, Math.max(0, Math.trunc(number(node(), 'ColumnsCount'))) || choices().length);
  const positions = createMemo(() => {
    const count = choices().length, width = columns();
    if (segments()) return choices().map((_, index) => ({ row: Math.floor(index / width), column: index % width }));
    // Radio buttons balance each column before filling it from top to bottom.
    const shortest = Math.floor(count / width), taller = count % width;
    return Array.from({ length: width }, (_, column) =>
      Array.from({ length: shortest + Number(column < taller) }, (_, row) => ({ row, column }))
    ).flat();
  });
  const rows = () => Math.ceil(choices().length / columns());
  const style = () => {
    const metrics = buttonMetrics(valueFont());
    return { ...(linux ? linuxFont(valueFont()) : font(valueFont(), state.os)),
      color: color(foreground()),
      '--taxi-radio-height': `${Math.max(19, metrics.lineHeight + 2)}px`,
      '--taxi-segment-height': `${Math.max(24, metrics.lineHeight + 2 * metrics.verticalPadding + 3)}px` };
  };

  return <div class="taxi-radios" data-representation={segments() ? 'segments' : 'buttons'} data-rows={rows()}
    role="radiogroup" aria-label={caption(node(), state)} aria-disabled={!enabled()} style={style()}>
    <For each={choices()}>{(choice, index) => {
      const label = () => text(choice, state.locale, state.strings).trimEnd();
      const width = createMemo(() => linux ? radioCaptionWidth(label(), valueFont()) : undefined);
      const checked = () => !segments() && index() === 0;
      const position = () => positions()[index()];
      const edge = (match) => segments() && match ? '' : undefined;
      const optionStyle = () => {
        const { row, column } = position();
        const grid = { 'grid-row': row + 1, 'grid-column': column + 1 };
        if (!segments()) return grid;
        const padding = Math.round(fontLineMetrics(valueFont()).pixels * 9 / 13);
        // Shared native dividers leave more of the intrinsic padding at the last cell.
        const adjustment = columns() === 1 ? 0 : column === 0 ? -1 : column < columns() - 1 ? -.5 : columns() / 2;
        return { ...grid, 'padding-inline': `${padding + adjustment}px`,
          'margin-inline-start': column ? '-1px' : undefined,
          'margin-block-start': row === 1 ? '-2px' : row > 1 ? '-1px' : undefined };
      };
      return <span class="taxi-radio-option" role="radio" aria-label={label()} aria-checked={checked()} style={optionStyle()}
        data-top={edge(position().row === 0)} data-bottom={edge(index() + columns() >= choices().length)}
        data-left={edge(position().column === 0)} data-right={edge(position().column === columns() - 1 || index() === choices().length - 1)}>
        <Show when={!segments()}><i classList={{ 'taxi-radio': true, checked: checked() }} aria-hidden="true"/></Show>
        <span class="taxi-radio-caption" style={{ width: width() === undefined ? undefined : `${width()}px` }}>
          <NativeLabel enabled={linux && !segments()} placement="radioChoice" text={label()} font={valueFont()}
            foreground={foreground()} runtime={props.controller.nativeText}/>
        </span>
      </span>;
    }}</For>
  </div>;
}
