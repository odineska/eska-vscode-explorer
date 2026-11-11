import { fieldWidth, fontLineHeight, inputRows, number, scalar, textInputWidthBounds } from './model.mjs';
import { pageInputTitlePair, automaticHorizontalSpacing, fixedPageInputs, horizontalInputMaximum, allocateLaneSizes, laneInputBounds, ordinaryGroup } from './layout-model.mjs';
import { borderBoxSize, boundingScale, boxInsets, pixels, updateStyle } from './layout-box.mjs';
import { fieldCaptionLines, fieldCaptionOccupiedWidth, fieldCaptionProfile } from './font-metrics.mjs';
import { allocateFieldCaption, inputCaptionInset, isolatedInputCaptionWidth } from './field-caption-layout.js';
import { fixedCaptionTracks, fixedTopPageTracks, narrowCaptionTracks, retainsFullPageTitle } from './caption-track-model.mjs';
import { inputLaneFields } from './input-lane-layout.js';
import { rowFitWidth, sidePageWidthBeforeCap, sideTabWidths } from './page-fit-layout.js';
import { pageScrollbar } from './page-scrollbar.js';

const total = widths => widths.reduce((sum, width) => sum + width, 0);
const kinds = new Set(['number', 'date', 'reference']);

function inputTitleField(node, { targets, scale, os }, minimumCaptions, page) {
  const element = targets.elements.get(node.key);
  const kind = node.presentation.valueType.kind;
  const location = node.presentation.titleLocation;
  const pageText = page && textInputWidthBounds(node, os);
  if ((!kinds.has(kind) && !pageText) || inputRows(node) > 1 || !['Left', 'Top', 'None'].includes(location)
      || minimumCaptions.has(node.key)) return;
  const flexible = element.dataset.stretchX === 'true';
  const cap = flexible ? horizontalInputMaximum(node, os) : undefined;
  const bounds = flexible ? laneInputBounds(node, os) : undefined;
  if (flexible && (!bounds || !pageText && (kind !== 'reference' || cap === undefined))) return;
  const row = element.querySelector(':scope > .taxi-field-row');
  const control = row?.querySelector(':scope > .taxi-field-control > .taxi-input');
  if (!control) return;
  const label = row.querySelector(':scope > .taxi-field-label');
  const title = label?.getAttribute('aria-label') ?? '';
  const caption = fieldCaptionProfile(title, node.presentation.titleFont, page
    ? { wordRuns: true, splitTerminalColon: true } : undefined);
  if (!caption) return;
  const preferred = flexible || page ? Math.min(fieldWidth(node, os), cap ?? Infinity) : borderBoxSize(control, scale).width;
  const minimum = bounds?.narrowMinimum ?? preferred;
  const maximum = pageText && flexible ? bounds.maximum : preferred;
  // A text field in a forced page row can shrink beside its side title.
  const sideValue = pageText ? minimum : bounds?.preferred ?? preferred;
  const side = location === 'Left' && !!title;
  const gap = side ? pixels(getComputedStyle(row).columnGap) : 0;
  const sideMinimum = side ? caption.minimum + inputCaptionInset + gap : 0;
  const automatic = side && scalar(node, 'TitleLocation', 'Auto') === 'Auto';
  const lineHeight = fontLineHeight(node.presentation.titleFont);
  return { key: node.key, kind, element, row, control, caption, lineHeight, location, side, automatic, gap, sideMinimum, minimum, preferred, maximum, sideValue, flexible };
}

function sideWidth(fields, above) {
  return Math.max(0, ...fields.filter(field => field.side && !above.has(field.key)).map(field => field.caption.minimum));
}

function widthFor(field, value, above, captionWidth, topWidth = field.caption.minimum) {
  if (field.side && !above.has(field.key)) return value + captionWidth + inputCaptionInset + field.gap;
  return Math.max(value, topWidth);
}

function pageSideCaption(field, width, keepFull) {
  const { caption, gap, minimum, preferred } = field;
  if (keepFull || caption.minimum === caption.preferred) return caption.preferred;
  if (field.flexible) return isolatedInputCaptionWidth(caption, width, gap, minimum, preferred) ?? caption.preferred;
  const available = width - preferred - gap - inputCaptionInset;
  return Math.min(caption.preferred, Math.max(caption.minimum, available));
}

function wrappedSideHeight(field, width) {
  const lines = fieldCaptionLines(field.caption, width).length;
  return lines > 1 ? lines * field.lineHeight + 2 : 0;
}

function pageHeightLimit(items, scale) {
  const page = items.parentElement;
  const contentHeight = () => borderBoxSize(page, scale).height - boxInsets(getComputedStyle(page)).height;
  if (page.closest('.taxi-element[data-kind=Pages]')?.dataset.stretchY === 'true') return contentHeight;
  // A non-stretching page cannot use the height that wrapping would add to itself.
  const preferred = contentHeight();
  return () => preferred;
}

function unwrappedTopHeights(fields, scale) {
  return fields.map(({ row, control, lineHeight }) => {
    const css = getComputedStyle(row);
    return borderBoxSize(control, scale).height + lineHeight + 1
      + pixels(css.getPropertyValue('--taxi-input-top-gap')) + 2 * pixels(css.getPropertyValue('--taxi-input-top-padding'));
  });
}

function topRowHeight({ fields, heights }, sizes) {
  return Math.max(...heights.map((height, index) => sizes
    ? height + (fieldCaptionLines(fields[index].caption, sizes[index]).length - 1) * fields[index].lineHeight
    : height));
}

function naturalSideCaption(field, page) {
  return page && field.side ? `${field.caption.preferred + inputCaptionInset}px` : '';
}

function allocateTopPageTitles(width, fitWidth, fields, lanes, rail) {
  const text = fields[0].kind === 'string' ? 0 : 1;
  const input = fields[text], fixed = fields[1 - text];
  const inputLane = lanes[text], fixedLane = lanes[1 - text];
  const compact = Math.max(input.preferred, input.caption.compact);
  const full = fixedLane.maximum;
  const ordered = sizes => text === 0 ? sizes : sizes.reverse();
  // The side-page fit tolerates three pixels before allocating a wrapped row.
  const tolerance = rail ? 3 : 0;
  const preferredText = Math.max(input.preferred, input.caption.preferred);
  const keepText = !input.flexible && fitWidth >= preferredText + full - tolerance;
  const textWidth = keepText ? preferredText : compact;
  if (fitWidth >= textWidth + full - tolerance) {
    const scroll = rail && (!input.flexible || rail.painted - rail.nominal > 1) && width < textWidth + full;
    let target = width - full;
    if (scroll) target = keepText ? textWidth : Math.min(textWidth, target + tolerance);
    const value = Math.max(inputLane.minimum, Math.min(target, inputLane.maximum));
    return { sizes: ordered([value, scroll ? width - value : full]), scroll, divider: scroll && keepText };
  }

  // Fit whole words in the fixed column before sharing the width that wrapping releases.
  const preferred = input.preferred <= inputLane.minimum ? inputLane.minimum
    : Math.min(fitWidth, Math.max(input.preferred, input.caption.preferred));
  const [provisional, budget] = allocateLaneSizes(fitWidth, [
    { minimum: inputLane.minimum, preferred },
    { minimum: fixedLane.minimum, preferred: full },
  ]);
  const fixedWidth = Math.max(fixedLane.minimum, fieldCaptionOccupiedWidth(fixed.caption, budget));
  const leadingWrap = text === 0 && input.caption.minimum < input.caption.preferred;
  const fitsCompact = width >= compact + fixedWidth && input.preferred <= input.caption.compact;
  const target = leadingWrap && !fitsCompact ? provisional : compact;
  const inputWidth = Math.max(inputLane.minimum, Math.min(target, width - fixedWidth));
  const bounds = [inputLane.maximum, full];
  const sizes = ordered(allocateLaneSizes(width, [inputWidth, fixedWidth].map((preferred, index) => ({
    minimum: preferred, preferred, maximum: bounds[index], growthWeight: preferred - 1,
  }))));
  // A wrapped leading title needs room for both tracks to change after packing.
  const canSplit = leadingWrap ? width - inputWidth - fixedWidth > 2 : sizes[0] > lanes[0].minimum;
  return { sizes, divider: canSplit && full > fixedLane.minimum };
}

function placements(columns) {
  const candidates = columns.map(({fields}) => fields.filter(field => field.automatic)
    .sort((a, b) => b.preferred + b.sideMinimum - a.preferred - a.sideMinimum));
  const plans = [];
  let above = new Set();
  const steps = Math.max(0, ...candidates.map(fields => fields.length));
  for (let step = 0; step <= steps; step++) {
    // Each column can release its widest side title before trying a smaller one.
    const captionWidths = columns.map(({fields}) => sideWidth(fields, above));
    const width = total(columns.map(({fields}, index) => Math.max(...fields.map(field =>
      widthFor(field, field.side && !above.has(field.key) ? field.sideValue : field.minimum, above, captionWidths[index])))));
    plans.push({above, width, captionWidths});
    above = new Set(above);
    for (const fields of candidates) if (fields[step]) above.add(fields[step].key);
  }
  return plans;
}

function alignFirstControls(items, fields, top) {
  // The caption may have changed height independently of its input.
  const scale = top ? boundingScale(items) : 1;
  const positions = fields.map(({element, row, control}) => {
    if (!top) return 0;
    const padding = pixels(element.style.getPropertyValue('--taxi-input-title-offset'));
    return Math.round((control.getBoundingClientRect().top - row.getBoundingClientRect().top) / scale - padding);
  });
  const baseline = Math.max(...positions);
  let changed = false;
  for (const [index, {element}] of fields.entries()) {
    const offset = baseline - positions[index], value = offset > 0 ? `${offset}px` : '';
    if (element.style.getPropertyValue('--taxi-input-title-offset') === value) continue;
    updateStyle(element, '--taxi-input-title-offset', value);
    changed = true;
  }
  return changed;
}

/** Keep the minimum width independent of the active caption position. */
export function inputTitleLayout(model, context, minimumCaptions) {
  const { targets, alignment, os, scale } = context;
  const minimumRows = new Map(), captionFields = new Set(), rows = [], stacks = [];
  function visit(node) {
    const items = targets.containers.get(node.key);
    const children = targets.children(node);
    const page = node.kind === 'Page' && children.every(child => child.kind === 'InputField')
      && children.some(child => child.presentation.valueType.kind === 'string');
    const grouping = node.presentation.grouping;
    const authoredTop = page && pageInputTitlePair(children, 'Top');
    const tabs = page ? items?.closest('.taxi-pages')?.querySelector(':scope > .taxi-tabs[data-side-fit-minimum]') : undefined;
    const fixed = page && fixedPageInputs(children, os);
    const conditionalRow = (authoredTop || fixed) && grouping === 'HorizontalIfPossible'
      && items?.classList.contains('taxi-items--horizontal');
    if (items && (page || ordinaryGroup(node)) && (grouping === 'Horizontal' || conditionalRow)
        && (children.length > 1 || fixed) && number(node, 'Width') <= 0
        && !items.parentElement.querySelector(':scope > .taxi-group-title')
        && !items.hasAttribute('data-united-horizontal-lane')) register(node, items, children, page, authoredTop, tabs, fixed);
    else if (fixed && tabs && items?.classList.contains('taxi-items--vertical') && number(node, 'Width') <= 0) {
      registerStack(items, children, tabs);
    }
    for (const child of node.children) visit(child);
  }

  function registerStack(items, children, tabs) {
    const fields = children.map(child => inputTitleField(child, context, minimumCaptions, true));
    if (fields.some(field => !field?.side)) return;
    const reserve = Math.max(...fields.map(field => field.preferred + field.gap)) + inputCaptionInset;
    const minimum = Math.max(...fields.map(field => field.caption.minimum));
    const preferred = Math.max(...fields.map(field => field.caption.preferred));
    minimumRows.set(items, reserve + minimum);
    const heights = fields.map(field => borderBoxSize(field.element, scale).height);
    const height = borderBoxSize(items, scale).height, pageHeight = pageHeightLimit(items, scale);
    alignment.mark(items, 'data-input-title-reflow', 'true');
    alignment.style(items, '--taxi-input-title-columns', '');
    for (const field of fields) {
      captionFields.add(field.key);
      alignment.style(field.element, '--taxi-field-caption-width', `${preferred + inputCaptionInset}px`);
      alignment.style(field.element, '--taxi-field-columns', 'var(--taxi-field-caption-width) minmax(0, 1fr)');
      alignment.style(field.element, '--taxi-field-track', '');
    }
    stacks.push({items, fields, tabs, reserve, minimum, preferred, heights, height, pageHeight,
      viewport: pageScrollbar(items, alignment, height)});
  }

  function register(node, items, children, page, authoredTop, tabs, fixed) {
    const columns = children.map(child => {
      const nodes = inputLaneFields(child, targets);
      if (!nodes?.length) return;
      const fields = nodes.map(field => inputTitleField(field, context, minimumCaptions, page));
      if (fields.some(field => !field)) return;
      return { element: targets.elements.get(child.key), fields };
    });
    if (columns.some(column => !column)) return;
    const fields = columns.flatMap(column => column.fields);
    if (!fixed && !fields.some(field => (page || field.side) && ['number', 'date'].includes(field.kind))) return;
    const top = authoredTop && (fixed || fields.some(field => field.flexible && field.kind === 'string') && fields.some(field => !field.flexible))
      ? fields : undefined;
    if (top) alignment.mark(items, 'data-authored-top-row');

    const gap = !page && automaticHorizontalSpacing(node) ? 11 : pixels(getComputedStyle(items).columnGap);
    const spacing = gap * (columns.length - 1);
    const plans = placements(columns);
    const preferred = total(columns.map(({fields}) => Math.max(...fields.map(field => field.side
      ? field.preferred + field.caption.preferred + inputCaptionInset + field.gap
      : Math.max(field.preferred, field.caption.preferred))))) + spacing;
    minimumRows.set(items, plans.at(-1).width + spacing);
    for (const name of ['--taxi-input-title-columns', '--taxi-input-title-gap']) alignment.style(items, name, '');
    alignment.mark(items, 'data-input-title-reflow', 'false');
    for (const column of columns) {
      const field = column.fields[0];
      alignment.style(column.element, '--taxi-field-track', top ? `${Math.max(field.preferred, field.caption.preferred)}px` : '');
      for (const field of column.fields) {
        captionFields.add(field.key);
        alignment.style(field.element, '--taxi-field-caption-width', naturalSideCaption(field, page));
        for (const name of ['--taxi-field-columns', '--taxi-input-title-value-min', '--taxi-input-title-value-max']) {
          alignment.style(field.element, name, '');
        }
      }
    }
    const first = columns.map(({fields}) => fields[0]);
    const align = children.every(child => scalar(child, 'GroupVerticalAlign', 'Auto') === 'Auto')
      && first.every(field => !field.element.dataset.groupVerticalAlign || field.element.dataset.groupVerticalAlign === 'Auto');
    if (align) for (const field of first) alignment.style(field.element, '--taxi-input-title-offset', '');
    const pair = page && columns.length === 2 ? { items, left: first[0].key, right: first[1].key } : undefined;
    const sideTracks = page && fields.every(field => field.side || field.location === 'None') ? fields.map(field => ({
      caption: field.caption, captionInset: field.side ? inputCaptionInset : 0,
      reserve: field.side ? field.gap + inputCaptionInset : 0,
      value: { minimum: field.minimum, preferred: field.preferred, maximum: field.maximum },
    })) : undefined;
    const unwrappedMinimum = sideTracks && spacing
      + total(sideTracks.map(({caption, reserve, value}) => caption.preferred + reserve + value.minimum));
    const scrollHeight = tabs && (top || fixed && sideTracks)
      ? Math.max(...fields.map(field => borderBoxSize(field.element, scale).height)) : undefined;
    const viewport = scrollHeight === undefined ? undefined : pageScrollbar(items, alignment, scrollHeight);
    const pageHeight = fixed && tabs ? pageHeightLimit(items, scale) : undefined;
    const topAlternative = fixed && tabs && pageInputTitlePair(children, 'Left') && fields.every(field => field.automatic)
      ? { fields, width: spacing + total(fields.map(field => Math.max(field.preferred, field.caption.preferred))) } : undefined;
    if (topAlternative) alignment.style(items, '--taxi-page-title-maximum', '');
    const fixedTop = fixed && tabs && (top || topAlternative) ? {
      text: fields[0].kind === 'string' ? 0 : 1, fields, heights: unwrappedTopHeights(fields, scale),
    } : undefined;
    if (fixedTop) alignment.style(items, '--taxi-page-title-minimum', '');
    rows.push({ owner: node.key, items, columns, gap, spacing, preferred, plans, page, pair, tabs, top,
      fixed, fixedTop, viewport, scrollHeight, pageHeight, sideTracks, unwrappedMinimum, topAlternative, first: align ? first : [] });
  }

  if (os === 'linux') visit(model);
  return {
    minimumRows, captionFields,
    allocate(captions, resolveDivider, frameOverflow) {
      const above = new Set();
      let heightChanged = false, overflowWidth;
      for (const {items, fields, tabs, reserve, minimum, preferred, heights, height, pageHeight, viewport} of stacks) {
        const available = rowFitWidth(items, scale), rail = sideTabWidths(tabs, scale);
        const width = Math.max(minimum, Math.min(preferred, available - reserve));
        const wrappedHeight = height + total(fields.map((field, index) =>
          Math.max(0, wrappedSideHeight(field, width) - heights[index])));
        // The tab strip can reserve the unwrapped stack while the painted tabs leave less width.
        const fitsNominal = rail && available + rail.painted - rail.nominal + .5 >= reserve + preferred;
        heightChanged = viewport(fitsNominal && wrappedHeight > pageHeight() + .5) || heightChanged;
        const track = `${Math.max(available, reserve + width)}px`;
        updateStyle(items, '--taxi-input-title-columns', track);
        for (const field of fields) {
          updateStyle(field.element, '--taxi-field-track', track);
          allocateFieldCaption(captions, field, width, inputCaptionInset);
        }
      }
      for (const row of rows) {
        const {owner, items, columns, gap, spacing, preferred, plans, page, pair, tabs, top,
          fixed, fixedTop, viewport, scrollHeight, pageHeight, sideTracks, unwrappedMinimum, topAlternative, first} = row;
        const available = rowFitWidth(items, scale);
        const rail = sideTabWidths(tabs, scale);
        // As for conditional rows, Designer tests the title fit against the nominal tab width.
        const tabOverlap = rail ? rail.painted - rail.nominal : 0;
        const fitWidth = available + tabOverlap;
        const placementWidth = rail && topAlternative ? sidePageWidthBeforeCap(tabs, fitWidth, scale) : fitWidth;
        const text = fixedTop?.fields[fixedTop.text];
        const retainText = rail && text && retainsFullPageTitle(text.caption);
        const retainedSide = retainText && topAlternative ? text.caption.preferred - text.caption.minimum : 0;
        const fit = plans.find((plan, index) => plan.width + spacing + (index === 0 ? retainedSide : 0) <= placementWidth + .5)
          ?? plans.at(-1);
        const plan = top || fit.above.size || available + .5 < preferred ? fit : undefined;
        const movedTop = topAlternative && fit.above.size === topAlternative.fields.length ? topAlternative : undefined;
        if (topAlternative) {
          const maximum = movedTop && !tabs.parentElement.hasAttribute('data-authored-side-stretch') ? `${movedTop.width}px` : '';
          heightChanged = updateStyle(items, '--taxi-page-title-maximum', maximum) || heightChanged;
        }
        const abovePage = page && plan && columns.some(({fields}) => fields.some(field =>
          field.location === 'Top' || plan.above.has(field.key)));
        // The rail's nominal width decides whether captions fit on one line. The actual
        // width left after painting the tabs can be smaller; shrink the value boxes first.
        const keepSideTitles = rail && !abovePage && fitWidth + .5 >= preferred && available + .5 >= unwrappedMinimum;
        const lanes = plan && columns.map(({fields}, index) => {
          const width = (bound, captionMetric) => Math.max(...fields.map(field => widthFor(field, field[bound], plan.above,
            page ? field.caption[captionMetric] : plan.captionWidths[index],
            page ? field.caption[captionMetric] : field.caption.minimum)));
          const minimum = width('minimum', keepSideTitles ? 'preferred' : 'minimum');
          const preferred = width('preferred', 'preferred');
          // Once a page moves its titles above, distribute space from the compact column widths.
          return abovePage ? { reserve: 0, minimum, preferred: minimum, maximum: width('maximum', 'preferred'), growthWeight: minimum }
            : { reserve: 0, minimum, preferred, maximum: preferred };
        });
        const width = Math.round(available - spacing);
        const packed = plan && !abovePage && !keepSideTitles && sideTracks
          && narrowCaptionTracks(width, sideTracks, Math.round(fitWidth - spacing));
        // Share the remaining width once a whole caption can be retained beside its value.
        const fixedFit = fixed && sideTracks && !abovePage && available < preferred - .5;
        const fixedSizes = fixedFit ? fixedCaptionTracks(width, sideTracks, Math.round(fitWidth - spacing),
          retainedSide ? fixedTop.text : undefined) : undefined;
        const sideSizes = fixedSizes ?? (packed && packed.some(({caption}, index) => caption === sideTracks[index].caption.preferred
          && sideTracks[index].caption.minimum < caption) ? packed : undefined);
        const topFields = top ?? movedTop?.fields;
        const requestedRowWidth = retainText && topFields ? placementWidth - (overflowWidth ??= frameOverflow()) : placementWidth;
        const topLayout = topFields && (fixedTop && rail
          ? fixedTopPageTracks(width, fitWidth - spacing, topFields, lanes, { requestedRowWidth, retainText, automatic: !!movedTop })
          : allocateTopPageTitles(width, fitWidth - spacing, topFields, lanes, rail));
        if (fixedTop) {
          const minimum = topLayout?.minimum ? `${topLayout.minimum + spacing}px` : '';
          heightChanged = updateStyle(items, '--taxi-page-title-minimum', minimum) || heightChanged;
        }
        const measureTop = fixedTop && (topLayout?.scroll || topLayout?.nominalSizes);
        const reservedHeight = measureTop ? topRowHeight(fixedTop, topLayout.nominalSizes) : scrollHeight;
        const paintedHeight = measureTop ? topRowHeight(fixedTop, topLayout.sizes) : 0;
        const topScroll = topLayout?.scroll || measureTop && paintedHeight > reservedHeight + .5;
        const expandedHeight = pageHeight && topScroll ? pageHeight() : 0;
        const fitsTopHeight = measureTop && expandedHeight > reservedHeight + .5 && paintedHeight <= expandedHeight + .5;
        const clippedByTabs = fixedSizes && rail && fitWidth + .5 >= preferred;
        const heightLimit = clippedByTabs ? pageHeight() : 0;
        const overflow = clippedByTabs && fixedSizes.some(({caption}, index) =>
          wrappedSideHeight(columns[index].fields[0], caption) > heightLimit + .5);
        heightChanged = (viewport?.(topScroll && !fitsTopHeight || overflow, reservedHeight) ?? false) || heightChanged;
        let sizes = topLayout?.sizes ?? sideSizes?.map(size => size.width) ?? (lanes && allocateLaneSizes(available - spacing, lanes));
        if (pair && (topLayout ? topLayout.divider : plan?.above.size === 2) && resolveDivider) {
          const [left, right] = lanes;
          const minimum = Math.max(left.minimum, width - right.maximum);
          const maximum = Math.min(left.maximum, width - right.minimum);
          const divider = resolveDivider(owner, pair, width, minimum, maximum, () => sizes[0]);
          if (divider?.tracks) sizes = [divider.value, width - divider.value];
        }
        if (items.dataset.inputTitleReflow !== String(!!plan)) items.dataset.inputTitleReflow = String(!!plan);
        updateStyle(items, '--taxi-input-title-columns', sizes ? sizes.map(width => `${width}px`).join(' ') : '');
        updateStyle(items, '--taxi-input-title-gap', plan ? `${gap}px` : '');
        for (const [index, {element, fields}] of columns.entries()) {
          const width = sizes?.[index];
          updateStyle(element, '--taxi-field-track', width === undefined ? '' : `${width}px`);
          for (const field of fields) {
            const moves = plan?.above.has(field.key);
            if (moves) above.add(field.key);
            const side = plan && field.side && !moves;
            let captionWidth;
            if (side) captionWidth = page ? sideSizes?.[index].caption ?? pageSideCaption(field, width, keepSideTitles)
              : plan.captionWidths[index];
            else if (plan && (moves || field.location === 'Top')) captionWidth = width;
            if (plan) allocateFieldCaption(captions, field, captionWidth, side ? inputCaptionInset : 0);
            else updateStyle(field.element, '--taxi-field-caption-width', naturalSideCaption(field, page));
            updateStyle(field.element, '--taxi-field-columns', side ? 'var(--taxi-field-caption-width) minmax(0, 1fr)' : '');
            updateStyle(field.element, '--taxi-input-title-value-min', plan && field.flexible ? `${field.minimum}px` : '');
            updateStyle(field.element, '--taxi-input-title-value-max', plan && field.flexible && Number.isFinite(field.maximum) ? `${field.maximum}px` : '');
          }
        }
        if (first.length) {
          const alignTop = plan && first.some(field => field.location === 'Top' || plan.above.has(field.key));
          heightChanged = alignFirstControls(items, first, alignTop) || heightChanged;
        }
      }
      return { above, heightChanged };
    },
  };
}
