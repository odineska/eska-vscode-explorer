import { caption } from './model.mjs';
import { borderBoxSize, boxInsets } from './layout-box.mjs';
import { labelDecorationLines, labelDecorationProfile } from './decoration-metrics.mjs';

/** Decoration reflow shares the form's existing allocation pass and resize observer. */
export function measureDecorations(model, { targets, os, scale }, state) {
  const entries = [];
  function visit(node) {
    if (os === 'linux' && node.kind === 'LabelDecoration') {
      const element = targets.elements.get(node.key)?.querySelector(':scope > .taxi-label');
      const profile = element && labelDecorationProfile(node, caption(node, state));
      if (profile) entries.push({ key: node.key, element, profile });
    }
    for (const child of node.children) visit(child);
  }
  visit(model);
  return { size: entries.length, allocate: () => new Map(entries.map(({ key, element, profile }) => [key,
    labelDecorationLines(profile, borderBoxSize(element, scale).width - boxInsets(getComputedStyle(element)).width)])) };
}
