import { flag, number, property, scalar } from './model.mjs';
import { ordinaryGroup } from './layout-model.mjs';
import { borderBoxSize, pixels } from './layout-box.mjs';

function registerRows(node, targets, fit, plans) {
  if (!targets.containers.has(node.key)) return;
  if (node.presentation.grouping === 'HorizontalIfPossible') {
    plans.set(node.key, fit);
    return;
  }
  if (node.presentation.grouping !== 'Vertical') return;
  for (const child of targets.children(node)) {
    if (ordinaryGroup(child) && scalar(child, 'Representation') === 'None' && number(child, 'Width') <= 0
      && !flag(child, 'ShowTitle') && !property(child, 'BackColor')) {
      registerRows(child, targets, fit, plans);
    }
  }
}

/** Side tabs occupy their painted width and contribute their nominal width to layout limits. */
export function sideTabWidths(tabs, scale) {
  if (tabs?.dataset.sideFitMinimum === undefined) return;
  const widths = [...tabs.children].map(button => pixels(button.style.width));
  if (!widths.length || widths.some(width => width === 0)) return;
  const button = getComputedStyle(tabs.firstElementChild), stack = getComputedStyle(tabs.nextElementSibling);
  const borders = pixels(button.borderLeftWidth) + pixels(button.borderRightWidth);
  const nominal = Math.max(Number(tabs.dataset.sideFitMinimum), Math.max(...widths) - borders);
  const painted = borderBoxSize(tabs, scale).width + pixels(stack.marginLeft) + pixels(stack.marginRight);
  return { nominal, painted };
}

/** Fit a row using the nominal tab width and the extra width of the shared caption. */
export function conditionalPageFits(model, { targets, scale }, captions) {
  const plans = new Map();
  function visit(node) {
    if (node.kind === 'Pages') {
      const pages = targets.elements.get(node.key)?.querySelector(':scope > .taxi-pages');
      if (!pages) return;
      const tabs = pages.querySelector(':scope > .taxi-tabs[data-side-fit-minimum]');
      const standard = ['Auto', 'None', 'TabsOnTop', 'TabsOnBottom'].includes(pages.dataset.representation);
      const reserve = tabs || standard ? captions.get(node.key) : undefined;
      if (tabs || reserve) {
        const fit = () => {
          const widths = sideTabWidths(tabs, scale);
          return (widths ? widths.painted - widths.nominal : 0) - (reserve?.() ?? 0);
        };
        for (const page of node.children) registerRows(page, targets, fit, plans);
      }
    }
    for (const child of node.children) visit(child);
  }
  visit(model);
  return plans;
}
