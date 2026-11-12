import { fieldWidth, inputControlHeight, inputRows, fontLineHeight, linuxFixedInputWidth, number, numericLabelMetrics, property, scalar, textLabelMetrics } from './model.mjs';
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
  const numeric = numericLabelMetrics(node, os);
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
  const inset = boxInsets(getComputedStyle(field)).width;
  const reserve = inset + (location === 'Left' ? 5 : 0);
  const movableTitle = !!label && location === 'Left' && !!profile && scalar(node, 'TitleLocation', 'Auto') === 'Auto';
  const preferredHeight = multiline ? inputControlHeight(node, os) : undefined;
  const authoredHeight = multiline && (element.hasAttribute('data-height-constrained') || !!element.closest('[data-authored-height]'));
  const maximumHeight = multiline ? controlBounds(node, 'y', preferredHeight, os, { authoredHeight }).maximum : undefined;
  return { element, field, key: node.key, multiline, preferredHeight, maximumHeight, label, caption, reserve, inset, movableTitle, shrinkCaptionWidth: caption.preferred,
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
const groupOffset = '--taxi-inline-group-offset';
const fieldHeightReserve = '--taxi-inline-field-height-reserve';
const valueControl = (track, selector) => track.field.querySelector(':scope > .taxi-field-control > ' + selector);

function labelBand(referenceFields) {
  let band;
  for (const { element, control } of referenceFields) {
    const box = element.getBoundingClientRect();
    if (!band || box.height > band.height) {
      const value = control.getBoundingClientRect();
      band = { height: box.height, center: value.top - box.top + value.height / 2 };
    }
  }
  return band;
}

function setLabelBand(items, height, fallback = '') {
  const heightChanged = updateStyle(items, '--taxi-inline-label-height', height ? `${height}px` : fallback);
  const alignmentChanged = updateStyle(items, '--taxi-inline-label-align', height ? 'start' : fallback);
  return heightChanged || alignmentChanged;
}

function alignFixedGroups(branch, verticalAlign, { alignment, scale }) {
  const groups = branch.parts.filter(part => part.parts).map(part => ({ part, tracks: flattenTracks(part) }));
  const growing = groups.filter(({ part }) => part.element.dataset.stretchY === 'true');
  const sources = growing.length ? growing : groups.filter(({ tracks }) => tracks.some(track => track.multiline));
  if (sources.length !== 1) return;
  const [source] = sources;
  if (source.part.element.hasAttribute('data-authored-group-height')) return;
  const inputs = source.tracks.filter(track => track.multiline);
  if (inputs.length !== 1) return;
  const [input] = inputs;
  const canPadGroup = verticalAlign === 'Bottom' && !input.element.hasAttribute('data-height-constrained');
  const sourceStretches = growing.length === 1;
  const inputStretches = input.element.dataset.stretchY === 'true';
  const stretchesField = sourceStretches && inputStretches;
  if (!stretchesField && !canPadGroup) return;
  const references = source.tracks.filter(track => track.label).map(track => ({
    element: track.element, control: valueControl(track, '.taxi-label-field'),
  })).filter(reference => reference.control);
  const control = valueControl(input, '.taxi-input');
  if (!control || !references.length) return;
  const peers = groups.filter(({ part, tracks }) => part !== source.part
    && part.element.dataset.stretchY === 'false' && !part.element.dataset.groupVerticalAlign
    && tracks.every(track => track.label)).map(section => ({
    ...section, control: valueControl(section.tracks[0], '.taxi-label-field'),
  })).filter(peer => peer.control);
  if (!peers.length) return;
  const sections = [source, ...peers];
  for (const { part } of sections) {
    alignment.style(part.items, '--taxi-inline-label-height', 'initial');
    alignment.style(part.items, '--taxi-inline-label-align', 'initial');
  }
  for (const { part } of peers) alignment.style(part.element, groupOffset, '');
  const { items: sourceItems } = source.part;
  const basePadding = canPadGroup ? pixels(getComputedStyle(sourceItems).paddingBottom) : 0;
  const inputLimit = input.maximumHeight ?? Infinity;
  if (!sourceStretches && inputStretches && inputLimit >= input.preferredHeight) {
    alignment.mark(input.element, 'data-inline-fixed-height');
  }
  const canExtendInput = canPadGroup && stretchesField && branch.element.dataset.stretchY === 'false'
    && !input.element.closest('[data-authored-height]');
  if (canPadGroup) alignment.style(sourceItems, 'padding-bottom', '');
  if (canExtendInput) alignment.style(input.element, fieldHeightReserve, '');

  function reserveHeight(group, field) {
    const paddingChanged = canPadGroup && updateStyle(sourceItems, 'padding-bottom', group ? `${basePadding + group}px` : '');
    const inputChanged = canExtendInput && updateStyle(input.element, fieldHeightReserve, field ? `${field}px` : '');
    return paddingChanged || inputChanged;
  }

  return {
    labelBands(captions, above) {
      let changed = false;
      for (const { part, tracks } of sections) {
        const height = Math.max(0, ...tracks.map(track => {
          const caption = captions.get(track.key);
          return caption && !above.has(track.key) ? caption.split('\n').length * track.titleLineHeight : 0;
        }));
        if (setLabelBand(part.items, height, 'initial')) changed = true;
      }
      return changed;
    },
    place() {
      const memo = control.getBoundingClientRect();
      if (memo.height / scale + .5 < input.preferredHeight) {
        for (const { part } of peers) updateStyle(part.element, groupOffset, '');
        return reserveHeight(0, 0);
      }
      // Separate groups follow the reference band at the input's preferred height.
      // The labels beside the input follow its full allocated height.
      const field = input.field.getBoundingClientRect(), css = getComputedStyle(input.field);
      const start = field.top + (pixels(css.paddingTop) + pixels(css.borderTopWidth)) * scale;
      const end = memo.top + input.preferredHeight * scale;
      const fraction = verticalAlign === 'Bottom' ? 1 : verticalAlign === 'Center' ? .5 : 0;
      const band = fraction ? labelBand(references) : undefined;
      const center = band ? start + (end - start - band.height) * fraction + band.center : start;
      const row = branch.items.getBoundingClientRect(), rowStyle = getComputedStyle(branch.items);
      const top = row.top + (pixels(rowStyle.paddingTop) + pixels(rowStyle.borderTopWidth)) * scale;
      const bottom = row.bottom - (pixels(rowStyle.paddingBottom) + pixels(rowStyle.borderBottomWidth)) * scale;
      // When the control stops at its preferred height, the extra space belongs below the group.
      const padGroup = canPadGroup && (!stretchesField || inputLimit <= input.preferredHeight);
      const canReserve = padGroup || canExtendInput;
      const addedPadding = sourceItems.style.paddingBottom ? pixels(sourceItems.style.paddingBottom) - basePadding : 0;
      const trailing = canReserve ? source.part.element.getBoundingClientRect().bottom - field.bottom - addedPadding * scale : 0;
      let reserve = 0;
      for (const peer of peers) {
        const element = peer.part.element, box = element.getBoundingClientRect();
        const previous = pixels(element.style.getPropertyValue(groupOffset));
        const value = peer.control.getBoundingClientRect();
        const shift = fraction ? center - value.top - value.height / 2 : start - box.top;
        const minimum = Math.ceil((top - box.top) / scale + previous);
        const maximum = Math.floor((bottom - box.bottom) / scale + previous);
        const offset = Math.max(minimum, Math.min(maximum, Math.round(shift / scale + previous)));
        if (canReserve) reserve = Math.max(reserve, Math.round((box.bottom + shift - end - trailing) / scale));
        updateStyle(element, groupOffset, offset ? `${offset}px` : '');
      }
      return reserveHeight(padGroup ? reserve : 0, padGroup ? 0 : reserve);
    },
  };
}

function compactLane(track, lane) {
  if (!track.movableTitle) {
    const weight = track.value.maximum > track.value.minimum ? lane.minimum - track.reserve : track.caption.minimum;
    return { ...lane, preferred: lane.minimum, growthWeight: weight };
  }
  const minimum = Math.max(track.caption.minimum, track.value.minimum);
  const maximum = Math.max(track.caption.preferred, track.value.maximum);
  return { reserve: track.inset, minimum: track.inset + minimum, preferred: track.inset + minimum,
    maximum: track.inset + maximum, growthWeight: minimum };
}

/** One horizontal allocation for an ordinary row of multiline inputs and labels, including plain nested groups. */
export function alignInlineFieldRows(model, context) {
  const { targets, alignment, os, scale } = context;
  const rows = [];
  function register(part, compactLanes, root = false) {
    let width;
    if (part.parts) {
      alignment.mark(part.items, 'data-native-inline-row');
      width = part.inset + part.spacing + sum(part.parts, child => register(child, compactLanes));
    } else {
      width = trackWidth(part, 'preferred');
      const minimum = compactLanes?.[part.index].minimum ?? trackWidth(part, 'minimum');
      alignment.style(part.element, '--taxi-inline-track-minimum', `${minimum}px`);
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
        const lanes = tracks.map((track, index) => {
          track.index = index;
          return {
            reserve: track.reserve + track.caption.preferred, minimum: trackWidth(track, 'minimum'),
            preferred: trackWidth(track, 'preferred'), maximum: track.reserve + track.caption.preferred + track.value.maximum,
            growthWeight: track.value.preferred - track.value.minimum + track.caption.preferred - track.caption.minimum,
          };
        });
        const compactLanes = tracks.some(track => track.movableTitle) ? tracks.map((track, index) => compactLane(track, lanes[index])) : undefined;
        const preferred = register(branch, compactLanes, true);
        alignment.style(branch.items, '--taxi-inline-label-height', '');
        alignment.style(branch.items, '--taxi-inline-label-align', '');
        const spacing = preferred - branch.inset - sum(lanes, lane => lane.preferred);
        const alignGroups = alignFixedGroups(branch, scalar(node, 'VerticalAlign', 'Auto'), context);
        rows.push({ branch, tracks, lanes, spacing, compactLanes, alignGroups, sideMinimum: sum(lanes, lane => lane.minimum) });
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

  function allocateWidths(captions, above) {
    let heightChanged = false;
    for (const { branch, tracks, lanes, spacing, compactLanes, sideMinimum, alignGroups } of rows) {
      const available = Math.round(borderBoxSize(branch.items, scale).width) - spacing;
      const compact = compactLanes && available < sideMinimum;
      const sizes = compact ? undefined : narrowCaptionTracks(available, tracks);
      const widths = sizes ? sizes.map(size => size.width) : allocateLaneSizes(available, compact ? compactLanes : lanes);
      let labelHeight = 0;
      for (const [index, track] of tracks.entries()) {
        if (!track.caption.preferred) continue;
        const top = compact && track.movableTitle;
        if (top) above.add(track.key);
        const size = compact && !top ? narrowCaptionTracks(widths[index], [track])?.[0] : sizes?.[index];
        const width = top ? widths[index] - track.inset : size?.caption ?? track.caption.preferred;
        if (allocateFieldCaption(captions, track, width) && !top) {
          labelHeight = Math.max(labelHeight, captions.get(track.key).split('\n').length * track.titleLineHeight);
        }
      }
      if (setLabelBand(branch.items, labelHeight)) heightChanged = true;
      if (alignGroups?.labelBands(captions, above)) heightChanged = true;
      for (const child of branch.parts) place(child, widths);
    }
    return heightChanged;
  }
  return {
    hasRows: rows.length > 0,
    allocateWidths,
    alignGroups: () => {
      let changed = false;
      for (const row of rows) if (row.alignGroups?.place()) changed = true;
      return changed;
    },
  };
}
