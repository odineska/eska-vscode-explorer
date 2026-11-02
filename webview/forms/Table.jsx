import { For, Show, createMemo } from 'solid-js';
import { scalar, flag, number, caption, fieldValue, fieldWidth, font, color } from './model.mjs';
import { CommandButton, Icon } from './Preview.jsx';

/** Header geometry is view state; column identities and effective properties remain backend-owned. */
export function tableColumns(root) {
  const leaves = [], rows = [];
  function visit(node, depth) {
    if (!flag(node, 'Visible')) return 0;
    if (!rows[depth]) rows[depth] = [];
    const children = node.children.filter(node => node.kind === 'ColumnGroup' || node.kind?.endsWith('Field'));
    if (node.kind === 'ColumnGroup' && children.length) {
      const cell = { node, span: 0, depth, leaf: false }; rows[depth].push(cell);
      cell.span = children.reduce((sum, child) => sum + visit(child, depth + 1), 0); return cell.span;
    }
    leaves.push(node); rows[depth].push({ node, span: 1, depth, leaf: true }); return 1;
  }
  for (const node of root.children.filter(node => node.kind === 'ColumnGroup' || node.kind?.endsWith('Field'))) visit(node, 0);
  return { leaves, rows };
}
export function Table(props) {
  const node = () => props.node, state = props.controller.state;
  const columns = createMemo(() => tableColumns(node()));
  const rows = createMemo(() => Array.from({ length: Math.max(1, Math.min(40, number(node(), 'Height', 8))) }, (_, index) => index));
  const bar = () => node().auxiliary.find(node => node.kind === 'AutoCommandBar');
  const selectColumn = (event, column) => { event.stopPropagation(); props.controller.select(column); };
  return <div class="taxi-table-field" style={{ width: number(node(), 'Width') ? `${number(node(), 'Width') * 8 + 4}px` : '100%' }}>
    <Show when={scalar(node(), 'CommandBarLocation') !== 'None'}><div class="taxi-table-command-bar">
      <Show when={!bar() || flag(bar(), 'AutoFill')}><For each={['Add', 'Copy', 'Delete', 'MoveUp', 'MoveDown']}>
        {name => <CommandButton controller={props.controller} picture={`StdPicture.${name}`} label={state.strings[`command.${name}`] ?? name} bar/>}
      </For></Show>
      <For each={bar()?.children ?? []}>{child => <CommandButton node={child} controller={props.controller} bar/>}</For>
      <span class="taxi-command-spacer"/><CommandButton controller={props.controller} label={state.strings.more} dropdown bar/>
    </div></Show>
    <div class="taxi-table-scroll" style={{ height: `${Math.max(2, number(node(), 'Height', 8)) * 22 + 24}px`, 'border-color': color(node().presentation.border), 'background-color': color(node().presentation.background) }}>
      <table class="taxi-table" style={{ ...font(node().presentation.font, state.os), color: color(node().presentation.foreground) }}>
        <colgroup><col style={{ width: '20px' }}/><For each={columns().leaves}>{column => <col style={{ width: `${number(column, 'Width') ? number(column, 'Width') * 8 + 4 : Math.min(220, fieldWidth(column))}px` }}/>}</For></colgroup>
        <Show when={flag(node(), 'Header')}><thead><For each={columns().rows}>{(row, depth) => <tr><Show when={depth() === 0}><th rowspan={columns().rows.length} class="taxi-table-selector"/></Show>
          <For each={row}>{cell => <th colspan={cell.span} rowspan={cell.leaf ? columns().rows.length - depth() : 1} data-column={cell.node.key} classList={{ selected: state.selected === cell.node.key }}
            onClick={event => selectColumn(event, cell.node)} style={{ ...font(cell.node.presentation.titleFont, state.os), 'text-align': scalar(cell.node, 'HeaderHorizontalAlign', 'Left').toLowerCase() }}>{caption(cell.node, state)}</th>}</For>
        </tr>}</For></thead></Show>
        <tbody><For each={rows()}>{index => <tr><td class="taxi-table-selector">{index === 0 ? '▸' : ''}</td><For each={columns().leaves}>{column => <td onClick={event => selectColumn(event, column)}
          classList={{ 'taxi-table-cell--active': index === 0 && state.selected === column.key }} style={{ 'text-align': scalar(column, 'HorizontalAlign', column.presentation.valueType.kind === 'number' ? 'Right' : 'Left').toLowerCase() }}>
          <Show when={index === 0}><Show when={column.kind === 'CheckBoxField'} fallback={fieldValue(column)}><span class="taxi-checkbox"/></Show></Show>
        </td>}</For></tr>}</For></tbody>
        <Show when={flag(node(), 'Footer', false)}><tfoot><tr><td/><For each={columns().leaves}>{column => <td>{scalar(column, 'FooterText')}</td>}</For></tr></tfoot></Show>
      </table>
    </div>
    <Show when={node().auxiliary.some(node => node.kind === 'ViewStatusAddition')}><div class="taxi-table-status"/></Show>
  </div>;
}
