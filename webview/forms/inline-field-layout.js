import { fieldWidth, inputRows, fontLineHeight, linuxFixedInputWidth, number, numericLabelMetrics, property, scalar, textLabelMetrics } from './model.mjs';
import { allocateLaneSizes, controlBounds, horizontalInputMaximum, ordinaryGroup, stretches } from './layout-model.mjs';
import { borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';
import { fieldCaptionProfile } from './font-metrics.mjs';
import { allocateFieldCaption } from './field-caption-layout.js';
import { narrowCaptionTracks } from './caption-track-model.mjs';

const sum = (values, read) => values.reduce((total, value) => total + read(value), 0);
const margins = element => {
  const css = getComputedStyle(element);
  return pixels(css.marginLeft) + pixels(css.marginRight);
};
const unbreakable = width => ({ minimum: width, compact: width, preferred: width });

function fieldTrack(node, element, { os, scale, collapsed }, fixed) {
  const multiline = linuxFixedInputWidth(node, os) && inputRows(node) > 1;
  const location = node.presentation.titleLocation;
  if (!(multiline ? ['Top', 'None'] : ['Left', 'None']).includes(location)) return;
  const numeric = numericLabelMetrics(node, os, { characterUnits: true });
  const label = numeric ?? textLabelMetrics(node, os);
  if (!multiline && !label) return;
  const field = element.querySelector(':scope > .taxi-field-row');
  if (!field || field.querySelector('[data-tooltip-button]')) return;
  const title = field.querySelector(':scope > .taxi-field-label');
  const titleWidth = title ? borderBoxSize(title, scale).width : 0;
  const profile = title && fieldCaptionProfile(title.getAttribute('aria-label') ?? '', node.presentation.titleFont);
  const caption = location === 'Left' ? profile ?? unbreakable(titleWidth) : unbreakable(0);
  const stretch = !fixed && stretches(node, 'x', collapsed);
  const titleFloor = multiline ? profile?.preferred ?? titleWidth : 0;
  const width = label?.preferred ?? fieldWidth(node, os);
  const bounds = stretch ? controlBounds(node, 'x', width, os) : {};
  const valueCap = stretch ? horizontalInputMaximum(node, os) ?? bounds.maximum ?? Infinity : width;
  // The upper caption owns its own width, even when the input has a smaller cap.
  const preferred = Math.max(titleFloor, Math.min(width, valueCap));
  const maximum = Math.max(titleFloor, valueCap);
  const floor = numeric?.minimum ?? (label ? 60 + (property(node, 'BackColor') ? 2 : 0) : Math.max(71, titleFloor));
  const minimum = stretch ? Math.min(preferred, floor) : preferred;
  const css = getComputedStyle(field);
  const reserve = boxInsets(css).width + (location === 'Left' ? 5 : 0);
  return { element, key: node.key, multiline, label, caption, reserve, shrinkCaptionWidth: caption.preferred,
    titleLineHeight: fontLineHeight(node.presentation.titleFont), valueMinimum: Math.min(minimum, valueCap),
    value: { minimum, preferred, maximum } };
}

function rowBranch(node, context, inheritedFixed = false) {
  const { targets } = context, element = targets.elements.get(node.key);
  const fixed = inheritedFixed || ['false', 'No', '0'].includes(scalar(node, 'HorizontalStretch'));
  if (!ordinaryGroup(node)) return fieldTrack(node, element, context, fixed);
  const items = targets.containers.get(node.key);
  const group = items?.parentElement;
  const children = targets.children(node);
  if (!items || !children.length || number(node, 'Width') > 0 || group.querySelector(':scope > .taxi-group-title')
      || items.matches('[data-united-columns], [data-united-items], [data-united-horizontal-lane], [data-through-labels], [data-input-title-reflow]')
      || children.length > 1 && node.presentation.grouping !== 'Horizontal') return;
  const parts = children.map(child => rowBranch(child, context, fixed));
  if (parts.some(part => !part)) return;
  const css = getComputedStyle(items);
  const spacing = boxInsets(css).width + pixels(css.columnGap) * (parts.length - 1)
    + sum(parts, part => margins(part.element));
  return { element, items, parts, spacing, inset: boxInsets(getComputedStyle(group)).width + margins(items) };
}

const flattenTracks = part => part.parts ? part.parts.flatMap(flattenTracks) : [part];
const trackWidth = (track, bound) => track.reserve + track.caption[bound] + track.value[bound];

/** One horizontal allocation for an ordinary row of multiline inputs and labels, including plain nested groups. */
export function alignInlineFieldRows(model, context) {
  const { targets, alignment, os, scale } = context;
  const rows = [];
  function register(part, root = false) {
    let width;
    if (part.parts) {
      alignment.mark(part.items, 'data-native-inline-row');
      width = part.inset + part.spacing + sum(part.parts, child => register(child));
    } else {
      width = trackWidth(part, 'preferred');
      alignment.style(part.element, '--taxi-inline-track-minimum', `${trackWidth(part, 'minimum')}px`);
      alignment.style(part.element, '--taxi-inline-value-minimum', `${part.valueMinimum}px`);
      if (part.label) alignment.style(part.element, '--taxi-inline-value-width', `${part.value.preferred}px`);
      if (part.caption.preferred) alignment.style(part.element, '--taxi-field-caption-width', `${part.caption.preferred}px`);
    }
    if (!root) alignment.style(part.element, '--taxi-inline-track-width', `${width}px`);
    return width;
  }
  function visit(node) {
    if (ordinaryGroup(node) && node.presentation.grouping === 'Horizontal' && targets.children(node).length > 1) {
      const branch = rowBranch(node, context);
      const tracks = branch ? flattenTracks(branch) : [];
      if (tracks.some(track => track.multiline) && tracks.some(track => track.label)) {
        const preferred = register(branch, true);
        alignment.style(branch.items, '--taxi-inline-label-height', '');
        alignment.style(branch.items, '--taxi-inline-label-align', '');
        const lanes = tracks.map((track, index) => {
          track.index = index;
          return {
            reserve: track.reserve + track.caption.preferred, minimum: trackWidth(track, 'minimum'),
            preferred: trackWidth(track, 'preferred'), maximum: track.reserve + track.caption.preferred + track.value.maximum,
            growthWeight: track.value.preferred - track.value.minimum + track.caption.preferred - track.caption.minimum,
          };
        });
        const spacing = preferred - branch.inset - sum(lanes, lane => lane.preferred);
        rows.push({ branch, tracks, lanes, spacing });
        return;
      }
    }
    for (const child of node.children) visit(child);
  }
  if (os === 'linux') visit(model);

  function place(part, widths) {
    const width = part.parts ? part.inset + part.spacing + sum(part.parts, child => place(child, widths)) : widths[part.index];
    updateStyle(part.element, '--taxi-inline-track-width', `${width}px`);
    return width;
  }

  return captions => {
    for (const { branch, tracks, lanes, spacing } of rows) {
      const available = Math.round(borderBoxSize(branch.items, scale).width) - spacing;
      const sizes = narrowCaptionTracks(available, tracks);
      const widths = sizes ? sizes.map(size => size.width) : allocateLaneSizes(available, lanes);
      let labelHeight = 0;
      for (const [index, track] of tracks.entries()) {
        if (!track.caption.preferred) continue;
        if (allocateFieldCaption(captions, track, sizes?.[index].caption ?? track.caption.preferred)) {
          labelHeight = Math.max(labelHeight, captions.get(track.key).split('\n').length * track.titleLineHeight);
        }
      }
      updateStyle(branch.items, '--taxi-inline-label-height', labelHeight ? `${labelHeight}px` : '');
      updateStyle(branch.items, '--taxi-inline-label-align', labelHeight ? 'start' : '');
      for (const child of branch.parts) place(child, widths);
    }
  };
}
