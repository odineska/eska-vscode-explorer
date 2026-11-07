import { fieldWidth, flag, number, scalar } from './model.mjs';
import { horizontalGrouping, laneInputBounds, ordinaryGroup } from './layout-model.mjs';
import { fieldCaptionProfile } from './font-metrics.mjs';
import { allocateFieldCaption, inputCaptionInset } from './field-caption-layout.js';
import { borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';

const leftLabelRow = '.taxi-field-row[data-title-location=Left]:has(> .taxi-field-label)';

function sharesLabels(node) {
  // An authored non-stretching group owns its caption tracks, including explicit Use.
  if (!ordinaryGroup(node) || !flag(node, 'HorizontalStretch')) return false;
  const mode = scalar(node, 'ThroughAlign', 'Auto');
  return mode === 'Use' || mode === 'Auto' && ['Auto', 'None'].includes(scalar(node, 'Representation', 'Auto'));
}

function labelScope(node) {
  return node.presentation.grouping === 'Vertical' && (['Form', 'Page'].includes(node.kind) || ordinaryGroup(node));
}

/** Share the leading title track across ordinary vertical groups without changing their owners. */
export function alignThroughLabels(model, { targets: { containers, children }, alignment, scale, os }) {
  const scopes = [];
  function visit(node, parentScope) {
    const items = containers.get(node.key);
    const horizontal = ordinaryGroup(node) && horizontalGrouping(node);
    const scope = items && !items.hasAttribute('data-united-flex-lane')
      && (horizontal ? parentScope : labelScope(node) ? parentScope ?? [] : undefined);
    const leading = horizontal ? items?.firstElementChild : undefined;
    if (scope) {
      const row = horizontal ? leading?.querySelector(`:scope > ${leftLabelRow}`)
        : items.querySelector(`:scope > .taxi-element--field > ${leftLabelRow}`);
      if (row) scope.push({ node, container: items, track: horizontal ? row : items, horizontal });
    }
    // A horizontal group continues the parent's column through its leading branch.
    // Other branches can still align within their own vertical scopes.
    for (const child of node.children) {
      const shared = scope && sharesLabels(child) && (!horizontal || child.key === leading?.dataset.element);
      visit(child, shared ? scope : undefined);
    }
    // A vertical stack made of horizontal rows shares its columns in alignUnitedColumns.
    if (!parentScope && scope?.some(entry => !entry.horizontal)) {
      if (scope.length > 1 || os === 'linux' && children(scope[0].node).some(separatedRow)) scopes.push(scope);
    }
  }
  visit(model);

  const tracks = scopes.map(scope => scope.map(({ node, container, track, horizontal }) => {
    const css = getComputedStyle(track);
    const width = parseFloat(css.gridTemplateColumns);
    const left = track.getBoundingClientRect().left / scale + parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
    return { node, container, horizontal, left, end: left + width };
  })).filter(scope => scope.every(track => Number.isFinite(track.end)));
  for (const scope of tracks) {
    if (scope.length === 1) continue;
    const end = Math.max(...scope.map(track => track.end));
    for (const {container, horizontal, left} of scope) {
      alignment.mark(container, 'data-through-labels', horizontal ? 'leading' : 'all');
      alignment.style(container, '--taxi-through-label-width', `${end - left}px`);
    }
  }
  return tracks;
}

function inputCaption(node, element, os) {
  const row = element.querySelector(`:scope > ${leftLabelRow}`);
  if (!row) return;
  const label = row.querySelector(':scope > .taxi-field-label');
  const caption = fieldCaptionProfile(label.getAttribute('aria-label') ?? '', node.presentation.titleFont);
  const preferredValue = fieldWidth(node, os) + pixels(getComputedStyle(row).columnGap);
  return { node, key: node.key, element, caption, preferredValue };
}

function separatedRow(node) {
  return ordinaryGroup(node) && node.presentation.grouping === 'Horizontal' && scalar(node, 'ThroughAlign') === 'DontUse';
}

function captionTrack(track, { targets, os, scale }, minimumCaptions) {
  const { node, container, horizontal } = track;
  if (container.hasAttribute('data-united-columns') || container.hasAttribute('data-united-horizontal-lane')) return;
  const children = targets.children(node);
  const participants = horizontal ? children.slice(0, 1) : children;
  const fields = participants.map(child => inputCaption(child, targets.elements.get(child.key), os)).filter(Boolean);
  if (!fields.length || fields.some(({ node, key, caption, element }) => node.kind !== 'InputField'
    || !caption || minimumCaptions.has(key) || element.style.getPropertyValue('--taxi-lane-input-min-width'))) return;
  if (horizontal && (children.length < 2 || node.presentation.grouping !== 'Horizontal' || number(node, 'Width') > 0
    || fields[0].element.dataset.stretchX !== 'true' || container.parentElement.querySelector(':scope > .taxi-group-title'))) return;
  const gap = pixels(getComputedStyle(container).columnGap);
  const preferredRow = horizontal ? children.reduce((width, child) =>
    width + borderBoxSize(targets.elements.get(child.key), scale).width, gap * (children.length - 1)) : 0;
  return { ...track, fields, preferredRow };
}

/** Reflow ordinary caption scopes with a horizontal row without replacing their fields. */
export function layoutThroughCaptions(scopes, context, minimumCaptions) {
  const { alignment, os, scale, targets } = context;
  if (os !== 'linux') return () => {};
  const allocations = [];
  for (const scope of scopes) {
    const separated = scope.flatMap(({node, horizontal}) => horizontal ? [] : targets.children(node).filter(separatedRow))
      .filter(node => targets.children(node).length > 1)
      .map(node => targets.containers.get(node.key)).filter(Boolean);
    if (!scope.some(track => track.horizontal) && !separated.length) continue;
    // Preferred alignment supports offsets; caption reflow is measured for tracks with one origin.
    if (scope.some(track => Math.abs(track.left - scope[0].left) > .5)) continue;
    const tracks = scope.map(track => captionTrack(track, context, minimumCaptions));
    if (tracks.some(track => !track)) continue;

    const fields = tracks.flatMap(track => track.fields);
    const width = metric => Math.max(...fields.map(field => field.caption[metric])) + inputCaptionInset;
    const preferred = width('preferred'), compact = width('compact'), minimum = width('minimum');
    if (minimum >= preferred) continue;
    const end = Math.max(...tracks.map(track => track.end));
    for (const items of separated) alignment.mark(items, 'data-through-separated-row');
    for (const track of tracks) {
      track.fullWidth = end - track.left;
      // Keep preferred controls in the horizontal row while testing the full caption.
      track.preferredValue = Math.max(0, track.preferredRow - track.fullWidth, ...track.fields
        .filter(field => field.caption.preferred + inputCaptionInset === preferred).map(field => field.preferredValue));
      if (tracks.length === 1) {
        alignment.mark(track.container, 'data-through-labels', 'all');
        alignment.style(track.container, '--taxi-through-label-width', `${track.fullWidth}px`);
      }
      alignment.style(track.container, '--taxi-through-allocated-label-width', '');
      for (const field of track.fields) {
        field.minimum = track.horizontal ? field.caption.minimum + inputCaptionInset : minimum;
        minimumCaptions.set(field.key, field.minimum);
        alignment.style(field.element, '--taxi-field-caption-width', '');
        field.capped = track.horizontal && field.element.hasAttribute('data-horizontal-input-limit');
        if (field.capped) {
          alignment.style(field.element, '--taxi-through-caption-reserve', '');
          const bounds = laneInputBounds(field.node, os);
          if (bounds) alignment.style(field.element, '--taxi-lane-input-min-width', `${bounds.narrowMinimum}px`);
        }
      }
    }
    allocations.push({ tracks, preferred, compact, minimum });
  }

  return function allocateWidths(captions, minima) {
    for (const { tracks, preferred, compact, minimum } of allocations) {
      const measured = tracks.map(({node, container, fields, horizontal, preferredValue}) => {
        const available = borderBoxSize(container, scale).width - boxInsets(getComputedStyle(container)).width;
        const reserve = horizontal ? (minima.get(node.key)?.width ?? 0) - fields[0].minimum
          : Math.max(...fields.map(field => (minima.get(field.key)?.width ?? 0) - field.minimum));
        return { capacity: available - reserve, full: preferred + Math.max(reserve, preferredValue) <= available + .5 };
      });
      const full = measured.every(track => track.full);
      const shared = measured.every(track => compact <= track.capacity + .5) ? compact : minimum;
      for (const [index, {container, horizontal, fields, fullWidth}] of tracks.entries()) {
        const [leading] = fields;
        const { capacity } = measured[index];
        const independent = horizontal && shared > capacity + .5;
        const assigned = full ? fullWidth : independent
          ? Math.max(leading.minimum, Math.min(capacity, leading.caption.preferred + inputCaptionInset)) : shared;
        updateStyle(container, '--taxi-through-allocated-label-width', full ? '' : `${assigned}px`);
        for (const field of fields) {
          const wrap = !full && assigned < field.caption.preferred + inputCaptionInset;
          allocateFieldCaption(captions, field, wrap ? assigned - inputCaptionInset : undefined, inputCaptionInset);
          if (field.capped) updateStyle(field.element, '--taxi-through-caption-reserve', `${assigned - field.minimum}px`);
        }
      }
    }
  };
}
