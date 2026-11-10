import { fieldWidth, inputPaintedOutset, inputRows, linuxFixedInputWidth, linuxReferenceInput, number, scalar, textInputWidthBounds } from './model.mjs';
import { horizontalGrouping, laneInputBounds, ordinaryGroup, referenceInputMinimum, sharesGroupLabels } from './layout-model.mjs';
import { fieldCaptionProfile } from './font-metrics.mjs';
import { allocateFieldCaption, growFieldCaption, inputCaptionInset } from './field-caption-layout.js';
import { borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';

const leftLabelRow = '.taxi-field-row[data-title-location=Left]:has(> .taxi-field-label)';

function labelScope(node, os) {
  return node.presentation.grouping === 'Vertical' && (['Form', 'Page'].includes(node.kind) || ordinaryGroup(node)
    || os === 'linux' && node.kind === 'UsualGroup' && scalar(node, 'Behavior') === 'Collapsible');
}

function automaticSideCaption(node) {
  return node.presentation.titleLocation === 'Left' && scalar(node, 'TitleLocation', 'Auto') === 'Auto'
    && scalar(node, 'ToolTipRepresentation') !== 'Button';
}

function movableNumber(node, os) {
  return node.presentation.valueType?.kind === 'number' && linuxFixedInputWidth(node, os) && automaticSideCaption(node);
}

function localInputStack(track, children, os) {
  if (track.node.kind !== 'UsualGroup' || track.horizontal) return false;
  const fields = children(track.node);
  return fields.length > 1 && fields.every(node => node.kind === 'InputField'
    && node.presentation.titleLocation === 'Left' && inputRows(node) === 1
    && (linuxReferenceInput(node, os) || textInputWidthBounds(node, os)));
}

/** Share the leading title track across ordinary vertical groups without changing their owners. */
export function alignThroughLabels(model, { targets: { containers, children }, alignment, scale, os }) {
  const scopes = [];
  function visit(node, parentScope, inheritedUse = false) {
    const items = containers.get(node.key);
    const horizontal = ordinaryGroup(node) && horizontalGrouping(node);
    const scope = items && !items.hasAttribute('data-united-flex-lane')
      ? horizontal ? parentScope : labelScope(node, os) ? parentScope ?? [] : undefined : undefined;
    const leading = horizontal ? items?.firstElementChild : undefined;
    if (scope) {
      const row = horizontal ? leading?.querySelector(`:scope > ${leftLabelRow}`)
        : items.querySelector(`:scope > .taxi-element--field > ${leftLabelRow}`);
      if (row) scope.push({ node, container: items, track: horizontal ? row : items, horizontal });
    }
    // A horizontal group continues the parent's column through its leading branch.
    // Other branches can still align within their own vertical scopes.
    const use = inheritedUse || scalar(node, 'ThroughAlign') === 'Use';
    for (const child of node.children) {
      const shared = scope && sharesGroupLabels(child, use) && (!horizontal || child.key === leading?.dataset.element);
      visit(child, shared ? scope : undefined, Boolean(shared && use));
    }
    // A vertical stack made of horizontal rows shares its columns in alignUnitedColumns.
    if (!parentScope && scope?.some(entry => !entry.horizontal)) {
      const local = os === 'linux' && scope.length === 1 && localInputStack(scope[0], children, os);
      const entries = children(scope[0].node);
      if (local || scope.length > 1 || os === 'linux' && (entries.some(separatedRow)
        || entries.length > 1 && entries.some(child => movableNumber(child, os)))) {
        scopes.push({ tracks: scope, local });
      }
    }
  }
  visit(model);

  const aligned = scopes.map(({ tracks, local }) => {
    const measured = tracks.map(({ node, container, track, horizontal }) => {
      const css = getComputedStyle(track);
      const width = parseFloat(css.gridTemplateColumns);
      const left = track.getBoundingClientRect().left / scale + parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
      return { node, container, horizontal, left, end: left + width };
    });
    return { tracks: measured, local };
  }).filter(({ tracks }) => tracks.every(track => Number.isFinite(track.end)));
  for (const { tracks: scope } of aligned) {
    if (scope.length === 1) continue;
    const end = Math.max(...scope.map(track => track.end));
    for (const {container, horizontal, left} of scope) {
      alignment.mark(container, 'data-through-labels', horizontal ? 'leading' : 'all');
      alignment.style(container, '--taxi-through-label-width', `${end - left}px`);
    }
  }
  return aligned;
}

function inputCaption(node, element, os) {
  const row = element.querySelector(`:scope > ${leftLabelRow}`);
  if (!row) return;
  const label = row.querySelector(':scope > .taxi-field-label');
  const caption = fieldCaptionProfile(label.getAttribute('aria-label') ?? '', node.presentation.titleFont);
  const gap = pixels(getComputedStyle(row).columnGap);
  return { node, key: node.key, element, caption, gap, preferredValue: fieldWidth(node, os) + gap };
}

function separatedRow(node) {
  return ordinaryGroup(node) && node.presentation.grouping === 'Horizontal' && scalar(node, 'ThroughAlign') === 'DontUse';
}

function captionTrack(track, { targets, os, scale }, minimumCaptions, adaptiveFields) {
  const { node, container, horizontal } = track;
  if (container.hasAttribute('data-united-columns') || container.hasAttribute('data-united-horizontal-lane')) return;
  const children = targets.children(node);
  const participants = horizontal ? children.slice(0, 1) : children;
  const fields = participants.map(child => inputCaption(child, targets.elements.get(child.key), os)).filter(Boolean);
  if (!fields.length || fields.some(({ node, key, caption, element }) => node.kind !== 'InputField'
    || !caption || minimumCaptions.has(key) || adaptiveFields.has(key) || element.style.getPropertyValue('--taxi-lane-input-min-width'))) return;
  if (horizontal && (children.length < 2 || node.presentation.grouping !== 'Horizontal' || number(node, 'Width') > 0
    || fields[0].element.dataset.stretchX !== 'true' || container.parentElement.querySelector(':scope > .taxi-group-title'))) return;
  const gap = pixels(getComputedStyle(container).columnGap);
  const preferredRow = horizontal ? children.reduce((width, child) =>
    width + borderBoxSize(targets.elements.get(child.key), scale).width, gap * (children.length - 1)) : 0;
  return { ...track, fields, preferredRow };
}

function sideReserve(field, minima) {
  const value = field.numberWidth ?? field.referenceWidth;
  return value === undefined ? (minima.get(field.key)?.width ?? field.minimum) - field.minimum : value + field.gap;
}

function captionStep(steps, tracks, minima, available) {
  // The fields whose captions set this step retain their preferred value widths.
  return steps?.find(width => tracks.every(({ fields }, index) => fields.every(field => {
    const reserve = sideReserve(field, minima);
    const setsWidth = field.caption.preferred + inputCaptionInset === width;
    const control = setsWidth ? Math.max(reserve, field.preferredValue) : reserve;
    return width + control <= available[index] + .5;
  })));
}

function allocateIndependentCaption(field, available, minima, captions, above, profileMinimum) {
  const reserve = sideReserve(field, minima);
  const capacity = available - reserve;
  // A compact profile keeps the positions chosen at its minimum until the shared track fits.
  const placementWidth = Math.min(available, profileMinimum ?? available);
  const top = field.canMoveAbove && placementWidth - reserve + .5 < field.minimum;
  if (top) above.add(field.key);
  const labelCapacity = Math.floor(capacity) - inputCaptionInset;
  const captionWidth = field.referenceWidth === undefined || top ? labelCapacity
    : Math.min(labelCapacity, growFieldCaption(field.caption, available, profileMinimum, field.gap + inputCaptionInset));
  const width = top ? available : Math.max(field.caption.minimum, captionWidth);
  allocateFieldCaption(captions, field, Math.min(field.caption.preferred, width), top ? 0 : inputCaptionInset);
  updateStyle(field.element, '--taxi-field-columns', top ? '' : 'var(--taxi-field-caption-width) minmax(0, 1fr)');
}

/** Reflow ordinary caption scopes while keeping their shared track and field owners. */
export function layoutThroughCaptions(scopes, context, minimumCaptions, adaptiveFields) {
  const { alignment, os, scale, targets } = context;
  const shared = [], stacks = [], stackLimits = new Map(), minimumInputs = new Map();
  for (const { tracks: scope, local } of os === 'linux' ? scopes : []) {
    const separated = scope.flatMap(({node, horizontal}) => horizontal ? [] : targets.children(node).filter(separatedRow))
      .filter(node => targets.children(node).length > 1)
      .map(node => targets.containers.get(node.key)).filter(Boolean);
    const vertical = !scope.some(track => track.horizontal) && !separated.length;
    // Preferred alignment supports offsets; caption reflow is measured for tracks with one origin.
    if (scope.some(track => Math.abs(track.left - scope[0].left) > .5)) continue;
    const tracks = scope.map(track => captionTrack(track, context, minimumCaptions, adaptiveFields));
    if (tracks.some(track => !track)) continue;

    const fields = tracks.flatMap(track => track.fields);
    const width = metric => Math.max(...fields.map(field => field.caption[metric])) + inputCaptionInset;
    const preferred = width('preferred'), compact = width('compact'), minimum = width('minimum');
    if (vertical) for (const field of fields) {
      if (field.element.dataset.stretchX === 'false' && movableNumber(field.node, os)) {
        field.numberWidth = fieldWidth(field.node, os) + inputPaintedOutset(field.node, os);
      }
    }
    const independentCaptions = fields.some(field => field.numberWidth !== undefined);
    if (minimum >= preferred && !local && !independentCaptions) continue;
    const referenceWidths = independentCaptions ? fields.map(field => referenceInputMinimum(field.node, os)) : [];
    const compactReferences = referenceWidths.some((width, index) => width !== undefined
      && fields[index].caption.minimum < fields[index].caption.preferred);
    if (compactReferences) for (const [index, field] of fields.entries()) {
      const width = referenceWidths[index];
      if (width === undefined) continue;
      if (field.element.dataset.stretchX === 'true') {
        field.referenceWidth = width;
        alignment.style(field.element, '--taxi-lane-input-min-width', `${width}px`);
      } else {
        field.referenceWidth = fieldWidth(field.node, os);
      }
    }
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
        field.minimum = track.horizontal || independentCaptions ? field.caption.minimum + inputCaptionInset : minimum;
        minimumCaptions.set(field.key, field.minimum);
        alignment.style(field.element, '--taxi-field-caption-width', '');
        if (independentCaptions) {
          field.canMoveAbove = field.numberWidth !== undefined || field.referenceWidth !== undefined && automaticSideCaption(field.node);
          const aboveWidth = field.canMoveAbove ? Math.max(field.numberWidth ?? field.referenceWidth, field.caption.minimum) : undefined;
          // Keep the side-caption budget available even when the physical minimum is smaller.
          minimumInputs.set(field.key, { alignedCaption: minimum, gap: field.gap, aboveWidth });
          alignment.style(field.element, '--taxi-field-columns', '');
        }
        field.capped = track.horizontal && field.element.hasAttribute('data-horizontal-input-limit');
        if (field.capped) {
          alignment.style(field.element, '--taxi-through-caption-reserve', '');
          const bounds = laneInputBounds(field.node, os);
          if (bounds) alignment.style(field.element, '--taxi-lane-input-min-width', `${bounds.narrowMinimum}px`);
        }
      }
    }
    const steps = vertical
      ? [...new Set(fields.map(field => field.caption.preferred + inputCaptionInset))]
        .filter(width => width > minimum).sort((a, b) => b - a)
      : undefined;
    const allocation = { tracks, preferred, compact, minimum, steps, independentCaptions, compactReferences };
    if (local) {
      const [track] = tracks;
      alignment.mark(track.container, 'data-through-input-stack');
      alignment.style(track.container, '--taxi-through-stack-width', '');
      track.parent = targets.elements.get(track.node.key).parentElement;
      stacks.push(allocation);
      const css = getComputedStyle(track.container);
      const insets = boxInsets(css).width, leading = pixels(css.paddingLeft) + pixels(css.borderLeftWidth);
      const maximumValue = Math.max(...track.fields.map(({ node, element, gap, preferredValue }) => {
        const maximum = pixels(element.style.getPropertyValue('--taxi-control-max-width'));
        const width = element.dataset.stretchX === 'false' ? preferredValue : maximum ? maximum + gap : Infinity;
        return width + inputPaintedOutset(node, os);
      }));
      stackLimits.set(track.container, (available, minima) => {
        const step = captionStep(steps, tracks, minima, [available - insets]) ?? minimum;
        return leading + (step === preferred ? track.fullWidth : step) + maximumValue;
      });
    } else {
      shared.push(allocation);
    }
  }

  function allocateWidths(allocations, captions, minima, above, leadingEdges) {
    for (const { tracks, preferred, compact, minimum, steps, independentCaptions, compactReferences } of allocations) {
      const measured = tracks.map(({node, container, fields, horizontal, preferredValue, parent}) => {
        // The stack has its own captions but occupies the leading track of the mixed rows.
        const edge = leadingEdges?.get(parent);
        if (edge !== undefined) {
          const width = Math.max(0, Math.round(edge - container.getBoundingClientRect().left / scale));
          updateStyle(container, '--taxi-through-stack-width', `${width}px`);
        }
        const available = borderBoxSize(container, scale).width - boxInsets(getComputedStyle(container)).width;
        const reserve = horizontal ? (minima.get(node.key)?.width ?? 0) - fields[0].minimum
          : Math.max(...fields.map(field => sideReserve(field, minima)));
        return { available, capacity: available - reserve, full: preferred + Math.max(reserve, preferredValue) <= available + .5 };
      });
      const step = steps && captionStep(steps, tracks, minima, measured.map(track => track.available));
      const shared = steps ? step ?? minimum
        : measured.every(track => compact <= track.capacity + .5) ? compact : minimum;
      const full = steps ? shared === preferred : measured.every(track => track.full);
      const separate = independentCaptions && measured.some(track => track.capacity + .5 < minimum);
      const profileMinimum = separate && compactReferences
        ? Math.max(0, ...tracks.flatMap(track => track.fields.map(field => minima.get(field.key)?.width ?? 0))) : undefined;
      for (const [index, {container, horizontal, fields, fullWidth}] of tracks.entries()) {
        const [leading] = fields;
        const { capacity, available } = measured[index];
        if (separate) {
          for (const field of fields) allocateIndependentCaption(field, available, minima, captions, above, profileMinimum);
          continue;
        }
        const independent = horizontal && shared > capacity + .5;
        const assigned = full ? fullWidth : independent
          ? Math.max(leading.minimum, Math.min(capacity, leading.caption.preferred + inputCaptionInset)) : shared;
        updateStyle(container, '--taxi-through-allocated-label-width', full ? '' : `${assigned}px`);
        for (const field of fields) {
          const wrap = !full && assigned < field.caption.preferred + inputCaptionInset;
          allocateFieldCaption(captions, field, wrap ? assigned - inputCaptionInset : undefined, inputCaptionInset);
          if (field.capped) updateStyle(field.element, '--taxi-through-caption-reserve', `${assigned - field.minimum}px`);
          if (independentCaptions) updateStyle(field.element, '--taxi-field-columns', '');
        }
      }
    }
  }
  return {
    stackLimits, minimumInputs,
    allocate: (captions, minima, above) => allocateWidths(shared, captions, minima, above),
    allocateStacks: (captions, minima, leadingEdges) => allocateWidths(stacks, captions, minima, undefined, leadingEdges),
  };
}
