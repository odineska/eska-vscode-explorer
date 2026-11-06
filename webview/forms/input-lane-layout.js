import { fieldWidth, flag, linuxFixedInputWidth, number } from './model.mjs';
import { horizontalLaneWidths, laneInputBounds, stretches, groupCanShrink } from './layout-model.mjs';
import { availableTrackWidth, borderBoxSize, updateStyle } from './layout-box.mjs';
import { designCaptionWidth, fieldCaptionProfile } from './font-metrics.mjs';
import { allocateFieldCaption, inputCaptionInset, throughCaptionWidth } from './field-caption-layout.js';
import { narrowInputLaneWidths } from './input-lane-model.mjs';

function inputField(node, element, flexible, os, collapsed) {
  const bounds = laneInputBounds(node, os);
  const stretch = flexible && stretches(node, 'x', collapsed);
  const label = element.querySelector(':scope > .taxi-field-row > .taxi-field-label');
  const title = label?.getAttribute('aria-label') ?? '';
  const preferred = stretch && bounds ? bounds.preferred : fieldWidth(node, os);
  return { node, key: node.key, element, label, title, bounds, stretch, preferred };
}

/** The 10 pt profiles add half of a reflowable title's text width to their value weight. */
function automaticFieldWeight({node, title, bounds}) {
  if (number(node, 'Width') > 0) return;
  const location = node.presentation.titleLocation;
  if (!['Left', 'None'].includes(location)) return;
  const text = title.replace(/:$/, '');
  if (/[\r\n]/u.test(text)) return;
  if (location === 'None' || !/\S +\S/u.test(text)) return bounds.valueWeight;
  const width = designCaptionWidth(text, node.presentation.titleFont);
  if (width !== undefined) return bounds.valueWeight + Math.floor(width / 2);
}

function preferredTrack(width, fields, grows) {
  const reserve = Math.max(0, width - Math.max(...fields.map(field => field.preferred)));
  const minimum = reserve + Math.max(...fields.map(field => field.stretch ? field.bounds.minimum : field.preferred));
  const maximum = grows ? reserve + Math.max(...fields.map(field => field.stretch ? field.bounds.maximum : field.preferred)) : width;
  const weights = grows ? fields.filter(field => field.stretch).map(automaticFieldWeight) : [];
  return { reserve, preferred: width, minimum: Math.min(width, minimum), maximum: Math.max(width, maximum),
    growthWeight: weights.every(weight => weight !== undefined) ? Math.max(0, ...weights) : undefined };
}

function narrowTrack(track, fields, scale, os) {
  const titled = !!fields[0].label;
  if (fields.some(({node, label, title}) => !!label !== titled
      || !['Left', 'None'].includes(node.presentation.titleLocation) || /[\r\n]/u.test(title)
      || flag(node, 'MultiLine', false))) return;
  const profiled = fields.map(field => {
    const caption = fieldCaptionProfile(field.title, field.node.presentation.titleFont);
    // A fixed text or date field in this native profile includes the trailing border.
    const fixedBorder = !field.stretch && !field.bounds && linuxFixedInputWidth(field.node, os)
      && ['string', 'date'].includes(field.node.presentation.valueType.kind)
      && (field.node.presentation.font?.points ?? 10) === 10;
    const minimum = field.stretch ? field.bounds.narrowMinimum : field.preferred + Number(fixedBorder);
    return { ...field, caption, minimum, fixedBorder };
  });
  if (profiled.some(field => !field.caption)) return;

  const width = metric => Math.max(...profiled.map(field => field.caption[metric]));
  const caption = { minimum: width('minimum'), compact: width('compact'), preferred: width('preferred') };
  const labelWidth = titled ? Math.max(...fields.map(field => borderBoxSize(field.label, scale).width)) : 0;
  // A title track owned by a wider outside scope cannot be shortened by this row.
  if (fields.some(field => throughCaptionWidth(field.element) > labelWidth + .5)) return;
  const reserve = Math.round(track.reserve - labelWidth) + (titled ? inputCaptionInset : 0);
  const stretch = fields.some(field => field.stretch);
  if (reserve < 0 || !stretch && caption.minimum < caption.preferred) return;
  const minimum = Math.max(...profiled.map(field => field.minimum));
  const preferred = Math.max(minimum, track.preferred - track.reserve);
  const maximum = Math.max(preferred, track.maximum - track.reserve);
  const minimumWidth = reserve + Math.max(...profiled.map(field => field.caption.minimum + field.minimum));
  const valueWeight = Math.max(1, ...fields.map(field => field.bounds?.valueWeight ?? 0));
  return { reserve, caption, value: { minimum, preferred, maximum }, minimumWidth, valueWeight,
    growthWeight: track.growthWeight, fields: profiled };
}

function captionWidth(track, field, size, atMinimum) {
  if (!size) return;
  if (!size.independent) return atMinimum ? field.caption.minimum : size.caption;
  if (!field.stretch) {
    return size.width >= track.reserve + size.caption + field.minimum ? size.caption : field.caption.minimum;
  }
  const growth = size.width - track.minimumWidth;
  const share = field.caption.minimum / (track.minimumWidth - track.reserve);
  return Math.min(field.caption.preferred, field.caption.minimum + Math.round(growth * share));
}

/** Column allocation is independent of which descendant rows share a vertical track. */
export function inputLaneLayout({ targets, alignment, collapsed, os, scale }) {
  const { elements, containers, children: mountedChildren } = targets;
  const { mark, style } = alignment;
  const allocations = [], minimumCaptions = new Map();

  function laneInputs(node) {
    if (node.kind === 'InputField') return [node];
    const items = containers.get(node.key);
    const children = mountedChildren(node);
    if (node.kind !== 'UsualGroup' || !items || number(node, 'Width') > 0
        || items.parentElement.querySelector(':scope > .taxi-group-title')
        || node.presentation.grouping !== 'Vertical' && children.length !== 1) return;
    const inputs = children.map(laneInputs);
    if (inputs.every(Boolean)) return inputs.flat();
  }

  function register(items, children, allowWrap) {
    if (os !== 'linux') return;
    const inputs = children.map(laneInputs);
    if (inputs.some(row => !row?.length)) return;
    const grows = children.map(node => stretches(node, 'x', collapsed));
    const fields = inputs.map((row, index) => {
      const flexible = grows[index] || groupCanShrink(children[index], os);
      return row.map(node => inputField(node, elements.get(node.key), flexible, os, collapsed));
    });
    const stretch = fields.flat().filter(field => field.stretch);
    if (stretch.some(field => !field.bounds)) return;
    for (const field of stretch) {
      if (!Number.isFinite(field.bounds.maximum)) continue;
      mark(field.element, 'data-lane-input-maximum');
      style(field.element, '--taxi-lane-input-max-width', `${field.bounds.maximum}px`);
    }
    const tracks = fields.map((row, index) => preferredTrack(borderBoxSize(elements.get(children[index].key), scale).width, row, grows[index]));
    const candidates = allowWrap && stretch.length ? tracks.map((track, index) => narrowTrack(track, fields[index], scale, os)) : [];
    const narrow = candidates.every(Boolean) && candidates.some(track => track.caption.minimum < track.caption.preferred) ? candidates : undefined;
    for (const field of stretch) {
      const minimum = narrow ? field.bounds.narrowMinimum : field.bounds.minimum;
      style(field.element, '--taxi-lane-input-min-width', `${minimum}px`);
    }
    for (const track of narrow ?? []) {
      for (const { element, key, label, caption, fixedBorder, minimum } of track.fields) {
        if (fixedBorder) {
          mark(element, 'data-lane-fixed-border');
          style(element, '--taxi-lane-fixed-width', `${minimum}px`);
        }
        if (!label) continue;
        minimumCaptions.set(key, caption.minimum + inputCaptionInset);
        style(element, '--taxi-field-caption-width', '');
        style(element, '--taxi-field-columns', '');
      }
    }
    const minimum = narrow?.reduce((total, track) => total + track.minimumWidth, 0);
    if (minimum !== undefined) style(items, '--taxi-input-lane-minimum', `${minimum}px`);
    allocations.push({ items, tracks, narrow, minimum });
    style(items, '--taxi-united-allocated-columns', '');
  }

  function allocateWidths(captions) {
    const measured = allocations.map(({ items, tracks, narrow, minimum }) => {
      const available = availableTrackWidth(items, tracks.length, scale);
      const reflow = narrow && narrowInputLaneWidths(available, narrow);
      const widths = reflow ? reflow.map(track => track.width) : horizontalLaneWidths(available, tracks);
      return { widths, reflow, atMinimum: available <= minimum };
    });
    for (const [index, { items, narrow }] of allocations.entries()) {
      const { widths, reflow, atMinimum } = measured[index];
      updateStyle(items, '--taxi-united-allocated-columns', widths.map(value => `${value}px`).join(' '));
      for (const [column, track] of (narrow ?? []).entries()) {
        const size = reflow?.[column];
        for (const field of track.fields) {
          if (!field.label) continue;
          allocateFieldCaption(captions, field, captionWidth(track, field, size, atMinimum), inputCaptionInset);
          updateStyle(field.element, '--taxi-field-columns', size ? 'var(--taxi-field-caption-width) minmax(0, 1fr)' : '');
        }
      }
    }
  }

  return { register, minimumCaptions, allocateWidths };
}
