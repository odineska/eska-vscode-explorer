import { checkboxField } from './checkbox-layout.js';
import { allocateFieldCaption, inputCaptionInset } from './field-caption-layout.js';
import { fieldCaptionOccupiedWidth, fieldCaptionProfile } from './font-metrics.mjs';
import { allocateLaneSizes, cappedTrackGrowth, groupCanShrink, roundTrackWidths } from './layout-model.mjs';
import { availableTrackWidth, borderBoxSize, boxInsets, pixels, updateStyle } from './layout-box.mjs';
import { fontLineHeight, inputPaintedOutset, scalar, textLabelMetrics } from './model.mjs';

function fixedDateField(node, { targets, os, scale }) {
  if (!['InputField', 'LabelField'].includes(node.kind) || node.presentation.valueType.kind !== 'date') return;
  const element = targets.elements.get(node.key);
  if (element.dataset.stretchX === 'true') return;
  const location = scalar(node, 'TitleLocation', 'Auto');
  const top = location === 'Top';
  const row = element.querySelector(`:scope > .taxi-field-row[data-title-location=${top ? 'Top' : 'Left'}]`);
  const label = row?.querySelector(':scope > .taxi-field-label');
  const control = row?.querySelector(':scope > .taxi-field-control:not([data-tooltip-button]) > :is(.taxi-input,.taxi-label-field)');
  if (!label || !control) return;
  const caption = fieldCaptionProfile(label.getAttribute('aria-label') ?? '', node.presentation.titleFont);
  if (!caption?.preferred) return;
  const value = borderBoxSize(control, scale).width + inputPaintedOutset(node, os);
  const rowStyle = getComputedStyle(row);
  const input = node.kind === 'InputField';
  const outset = input ? 0 : textLabelMetrics(node, os)?.outset ?? 0;
  return { element, key: node.key, caption, value, input, top, outset,
    lineHeight: pixels(getComputedStyle(label).lineHeight), wrappedLineHeight: fontLineHeight(node.presentation.titleFont),
    gap: pixels(rowStyle.columnGap),
    aboveHeight: top ? borderBoxSize(label, scale).height + pixels(rowStyle.rowGap) : 0,
    automatic: location === 'Auto' };
}

function captionWidths(space, date, checkbox) {
  if (space >= date.preferred + checkbox.preferred) return [date.preferred, checkbox.preferred];
  if (space >= date.shortest + checkbox.preferred) return [space - checkbox.preferred, checkbox.preferred];
  if (space >= date.preferred + checkbox.compact) return [date.preferred, space - date.preferred];
  const widths = allocateLaneSizes(space, [date, checkbox]);
  if (widths[1] >= checkbox.compact) return widths;
  // Before the checkbox can lose a line, use the extra width for the shared date captions.
  const first = Math.min(date.preferred, space - checkbox.minimum);
  return [first, space - first];
}

function dateCaptions(fields, minimum = Math.max(0, ...fields.map(field => field.caption.minimum))) {
  const widths = fields.map(field => field.caption.preferred);
  return { minimum, preferred: Math.max(0, ...widths), shortest: widths.length ? Math.min(...widths) : 0 };
}

function packSideCaptions(available, { base, fields, date, checkbox, minimumWidth, minimumTitle }) {
  const space = available - base;
  if (space < date.minimum + checkbox.minimum) return;
  const [budget] = allocateLaneSizes(space, [date, checkbox], { fractional: true });
  const title = Math.max(...fields.map(field => fieldCaptionOccupiedWidth(field.caption, budget)));
  if (title < minimumTitle) return;
  const check = fieldCaptionOccupiedWidth(checkbox, space - title);
  const width = base + title + check;
  if (width < minimumWidth) return;

  return {
    width,
    allocate(available) {
      // A stretching neighbor can keep part of the unused column width.
      const growth = cappedTrackGrowth(Math.max(0, available - width), [
        { weight: title, limit: date.preferred - title },
        { weight: check, limit: checkbox.preferred - check },
      ]);
      const [titleWidth, checkWidth] = roundTrackWidths([title + growth[0], check + growth[1]], Math.floor);
      return { width: base + titleWidth + checkWidth, title: titleWidth, check: checkWidth };
    },
  };
}

function partialDateCaptions({ leading, label, base, topValue, sideValue, checkbox }) {
  const labelValue = label.value + label.gap + inputCaptionInset;
  const minimumTrack = Math.max(topValue, labelValue + label.caption.compact);
  const preferredTrack = Math.max(topValue, labelValue + label.caption.preferred);
  return {
    minimum: base + Math.max(topValue, labelValue - label.outset + label.caption.compact) + checkbox.minimum,
    leadingMinimum: leading.automatic ? base + sideValue + leading.caption.minimum + checkbox.minimum : undefined,
    valueWeight: label.value - label.outset,
    preferredWeight: label.value - label.outset + label.caption.preferred,
    allocate(width, leadingSide) {
      const caption = leadingSide ? leading.caption.minimum : label.caption.compact;
      const value = leadingSide ? sideValue : labelValue;
      const minimum = leadingSide ? value + caption : minimumTrack;
      const preferred = leadingSide ? value + leading.caption.preferred : preferredTrack;
      const available = width - base;
      // Keep the label's full title once it fits alongside the checkbox's shortest lines.
      const spare = Math.max(0, available - minimum - checkbox.minimum);
      const weight = leadingSide ? caption : caption + label.outset;
      const track = available >= preferred + checkbox.minimum ? preferred
        : minimum + Math.round(spare * weight / (weight + checkbox.minimum));
      const check = Math.min(checkbox.preferred, available - track);
      return {
        width: base + track + check, title: track - value, check, track,
        label: { key: label.key, title: track - labelValue },
        sideKeys: leadingSide ? [leading.key, label.key] : [label.key],
      };
    },
  };
}

/** A non-united row exposes its leading date to the vertical block's shared caption column. */
export function dateBlockLayout(model, context) {
  const { targets, alignment, os, scale } = context;
  const minimumRows = new Map(), minimumCaptions = new Map(), titleFloors = new Map(), blocks = [];

  function visit(node) {
    const items = targets.containers.get(node.key);
    if (items && node.presentation.grouping === 'Vertical' && groupCanShrink(node, os)
      && targets.elements.get(node.key)?.dataset.stretchX === 'false') register(node, items);
    for (const child of node.children) visit(child);
  }

  function register(node, items) {
    const group = items.parentElement, owner = group.parentElement;
    if (group.querySelector(':scope > .taxi-group-title')) return;
    const children = targets.children(node);
    const rows = children.filter(child => child.presentation.grouping === 'Horizontal'
      && child.presentation.united === false && groupCanShrink(child, os));
    if (rows.length !== 1 || children.length < 2) return;
    const [rowNode] = rows;
    const row = targets.containers.get(rowNode.key);
    if (!row || row.parentElement.querySelector(':scope > .taxi-group-title') || boxInsets(getComputedStyle(row.parentElement)).width) return;
    const [first, ...rest] = targets.children(rowNode);
    if (!first || !rest.length) return;
    const leading = fixedDateField(first, context), checkbox = checkboxField(rest.at(-1), context);
    if (!leading || !checkbox || checkbox.caption.minimum === checkbox.caption.preferred) return;
    const middle = rest.slice(0, -1).map(child => targets.elements.get(child.key));
    if (middle.some(element => !['Button', 'PictureField'].includes(element.dataset.kind) || element.dataset.stretchX === 'true')) return;
    const fields = children.map(child => child === rowNode ? leading : fixedDateField(child, context));
    if (fields.some(field => !field)) return;
    const sideFields = fields.filter(field => !field.top);
    const fixedTop = !sideFields.length;
    const authoredTop = sideFields.length < fields.length;

    alignment.mark(row, 'data-checkbox-row');
    alignment.mark(row, 'data-fixed-date-row');
    if (leading.top && !fixedTop) alignment.mark(targets.elements.get(rowNode.key), 'data-fixed-date-lane');
    const spacing = (middle.length + 1) * pixels(getComputedStyle(row).columnGap);
    const middleWidths = middle.map(element => borderBoxSize(element, scale).width);
    const fixed = middleWidths.reduce((sum, width) => sum + width, checkbox.reserve);
    const gapField = leading.top ? sideFields.find(field => field.input) ?? sideFields[0] ?? leading : leading;
    const sharedValue = Math.max(leading.value, ...sideFields.map(field => field.value));
    const sideValue = sharedValue + gapField.gap + inputCaptionInset;
    const topValue = Math.max(sharedValue, leading.caption.minimum);
    const sideFieldWidth = field => field.value + field.gap + inputCaptionInset;
    const locked = sideFields.filter(field => !field.automatic);
    // Each forced side caption only requires the width of its own field.
    const lockedValue = Math.max(0, ...locked.map(sideFieldWidth));
    const lockedWidth = Math.max(0, ...locked.map(field => sideFieldWidth(field) + field.caption.minimum));
    const lockedTrack = Math.max(topValue, lockedWidth);
    const lockedDate = locked.length ? dateCaptions(locked, Math.max(0, lockedWidth - lockedValue)) : undefined;
    const date = dateCaptions(sideFields);
    const canMove = sideFields.some(field => field.automatic);
    const sideMinimum = fixed + sideValue + date.minimum + checkbox.caption.minimum;
    const topMinimum = fixed + topValue + checkbox.caption.minimum;
    const topPreferred = Math.max(sharedValue, leading.caption.preferred);
    const rowPreferred = fixed + (fixedTop ? topPreferred : sideValue + date.preferred) + checkbox.caption.preferred;
    const preferred = Math.max(rowPreferred, leading.top ? fixed + topPreferred + checkbox.caption.preferred : 0,
      ...fields.filter(field => field.top).map(field => Math.max(field.value, field.caption.preferred) - spacing));
    const rowMinimum = fixed + lockedTrack + checkbox.caption.minimum + spacing;
    minimumRows.set(row, rowMinimum);
    // The block keeps a stable minimum while its fields change caption positions.
    const aboveWidth = Math.max(topMinimum + spacing, ...fields.map(field => Math.max(field.value, field.caption.minimum)));
    const sideTrackWidth = field => field.value + field.gap + date.minimum;
    const sideWidth = Math.max(aboveWidth, sideMinimum + spacing, ...sideFields.map(field => sideTrackWidth(field) + inputCaptionInset));
    const minimum = Math.max(aboveWidth, rowMinimum);
    minimumRows.set(items, minimum);
    const mixedInset = canMove && !leading.top && sideFields.some(field => field.automatic && field !== leading && field.input) ? inputCaptionInset : 0;
    const mixedWidth = mixedInset
      ? Math.max(aboveWidth, sideMinimum + spacing - mixedInset, ...sideFields.filter(field => !field.input).map(sideTrackWidth))
      : sideWidth;
    for (const [container, mode] of fixedTop ? [] : [[items, 'all'], [row, 'leading']]) {
      alignment.mark(container, 'data-through-labels', mode);
      alignment.style(container, '--taxi-through-label-width', `${date.preferred + inputCaptionInset}px`);
      alignment.style(container, '--taxi-through-allocated-label-width', '');
    }
    for (const field of fields) {
      if (!field.top) minimumCaptions.set(field.key, field.automatic ? 0 : (lockedDate?.minimum ?? date.minimum) + inputCaptionInset);
      alignment.style(field.element, '--taxi-field-caption-width', '');
      if (!field.input) {
        alignment.mark(field.element, 'data-fixed-date-label');
        alignment.style(field.element, '--taxi-date-label-caption-width', '');
        alignment.style(field.element, '--taxi-date-label-offset', '');
      }
    }
    const elements = [leading.element, ...middle, checkbox.element];
    const heights = elements.map(element => borderBoxSize(element, scale).height);
    heights[0] -= leading.aboveHeight;
    const rowHeight = Math.max(...heights);
    const slots = elements.map((element, index) => ({ element, offset: (rowHeight - heights[index]) / 2 }));
    for (const element of elements) {
      alignment.style(element, '--taxi-field-track', '');
      alignment.style(element, '--taxi-fixed-date-top', '');
    }
    alignment.style(checkbox.element, '--taxi-field-caption-width', '');
    alignment.mark(owner, 'data-fixed-date-block', authoredTop ? 'authored' : '');
    alignment.style(leading.element, '--taxi-date-title-line-height', `${leading.wrappedLineHeight}px`);
    const outer = spacing + boxInsets(getComputedStyle(group)).width;
    if (fixedTop) {
      titleFloors.set(node.key, {
        mixed: 0, side: 0, compactWidth: Math.round(fixed + topPreferred + checkbox.caption.compact + outer),
      });
    } else {
      const topWidth = Math.max(0, ...fields.filter(field => field.top).map(field => Math.max(field.value, field.caption.preferred)));
      const profile = {
        base: fixed + sideValue + outer, fields: sideFields, date, checkbox: checkbox.caption,
        minimumWidth: Math.max(topWidth, sideWidth + outer - spacing),
        minimumTitle: leading.top ? topPreferred - sideValue : 0,
      };
      const labels = sideFields.filter(field => !field.input);
      const transition = authoredTop && canMove && !locked.length ? {
        leadingTop: leading.top, widerValue: sharedValue > leading.value,
        abovePreferred: Math.max(fixed + topPreferred + checkbox.caption.preferred + outer,
          ...fields.map(field => Math.max(field.value, field.caption.preferred))),
        sideMinimum: mixedWidth + outer - spacing,
        partial: labels.length === 1 ? partialDateCaptions({
          leading, label: labels[0], base: fixed + outer, topValue, sideValue, checkbox: checkbox.caption,
        }) : undefined,
      } : undefined;
      titleFloors.set(node.key, {
        mixed: canMove ? Math.max(0, mixedWidth - minimum) : 0,
        side: canMove ? Math.max(0, sideWidth - minimum) : 0,
        pack: canMove || sideValue === lockedValue ? width => packSideCaptions(width, profile) : undefined,
        transition,
      });
    }
    // Use the same calibrated width for preferred measurement and for a fully expanded block.
    alignment.style(owner, '--taxi-fixed-date-width', `${Math.round(preferred + outer)}px`);
    for (const [index, element] of middle.entries()) updateStyle(element, '--taxi-field-track', `${middleWidths[index]}px`);
    blocks.push({ key: node.key, items, row, owner, fields, leading, checkbox, date, fixed, sideValue, topValue, topPreferred, canMove, authoredTop,
      sideMinimum, preferred, slots, outer, mixedInset, mixedWidth, sideWidth, spacing, lockedValue, lockedDate });
  }

  if (os === 'linux') visit(model);
  return {
    minimumRows, minimumCaptions, titleFloors,
    allocate(captions, above, columnFraction, packedDates) {
      for (const block of blocks) {
        const { key, items, row, owner, fields, leading, checkbox, date, fixed, sideValue, topValue, topPreferred,
          canMove, authoredTop, sideMinimum, preferred, slots, outer, mixedInset, mixedWidth, sideWidth, spacing,
          lockedValue, lockedDate } = block;
        const width = authoredTop ? preferred : sideMinimum + (preferred - sideMinimum) * columnFraction(owner);
        const packed = packedDates.get(key);
        updateStyle(owner, '--taxi-fixed-date-width', `${packed?.width ?? Math.round(width + outer)}px`);
        const available = availableTrackWidth(row, slots.length, scale);
        const sideUnavailable = canMove && available + spacing < Math.round(mixedWidth);
        const lockedOnly = sideUnavailable || !canMove;
        const active = lockedOnly ? lockedDate : date;
        // A standalone date joins the aligned caption track once its extra inset fits.
        const moveStandalone = canMove && available + spacing < Math.round(sideWidth);
        const moveAbove = field => field.top || field.automatic && (packed?.sideKeys
          ? !packed.sideKeys.includes(field.key) : sideUnavailable || field !== leading && field.input && moveStandalone);
        const moveRow = moveAbove(leading);
        const inset = moveStandalone && !sideUnavailable ? inputCaptionInset - mixedInset : inputCaptionInset;
        const sideTrack = (lockedOnly ? lockedValue : sideValue) - inputCaptionInset + inset;
        const space = available - fixed - sideTrack;
        const minimum = active
          ? Math.max(lockedDate?.minimum ?? 0, Math.min(active.minimum, space - checkbox.caption.minimum)) : 0;
        const [title, sideCheck] = packed?.title !== undefined ? [packed.title, packed.check] : active
          ? captionWidths(Math.max(space, minimum + checkbox.caption.minimum), { ...active, minimum }, checkbox.caption) : [0, 0];
        // A top caption can still share the track reserved by its side-captioned siblings.
        const sideReserve = leading.top && active ? sideTrack + title : 0;
        const topTrack = leading.top
          ? Math.max(topValue, Math.min(topPreferred, available - fixed - checkbox.caption.minimum))
          : topValue;
        const track = packed?.track ?? (moveRow ? Math.max(topTrack, sideReserve) : sideTrack + title);
        const check = packed?.sideKeys ? sideCheck : moveRow
          ? Math.min(checkbox.caption.preferred, Math.max(checkbox.caption.minimum, available - fixed - track)) : sideCheck;
        const shared = active || packed?.sideKeys ? `${title + inset}px` : '';
        for (const container of [items, row]) updateStyle(container, '--taxi-through-allocated-label-width', shared);
        updateStyle(leading.element, '--taxi-field-track', `${track}px`);
        updateStyle(checkbox.element, '--taxi-field-track', `${checkbox.reserve + check}px`);
        allocateFieldCaption(captions, checkbox, check);
        const outsideCaptionWidth = available + (authoredTop ? spacing : 0);
        for (const field of fields) {
          const move = moveAbove(field);
          if (move && !field.top) above.add(field.key);
          const ownTitle = packed?.label?.key === field.key ? packed.label.title : undefined;
          if (!field.input) {
            updateStyle(field.element, '--taxi-date-label-caption-width', ownTitle === undefined ? '' : `${ownTitle + inset}px`);
            updateStyle(field.element, '--taxi-date-label-offset', moveRow && !move ? '1px' : '');
          }
          allocateFieldCaption(captions, field, move ? (field === leading ? track : outsideCaptionWidth) : ownTitle ?? title, move ? 0 : inset);
        }
        const wrappedTitle = captions.get(leading.key);
        const titleLines = wrappedTitle?.split('\n').length ?? leading.caption.paragraphs.length;
        const raisedTitle = moveRow ? titleLines * (wrappedTitle ? leading.wrappedLineHeight : leading.lineHeight) : 0;
        // Keep the preferred baselines as the row grows, allowing room for a title above the date.
        for (const { element, offset } of slots) {
          const top = moveRow && element === leading.element ? 0 : offset + raisedTitle;
          updateStyle(element, '--taxi-fixed-date-top', top ? `${top}px` : '');
        }
      }
    },
  };
}
