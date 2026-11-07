import { borderBoxSize, pixels, updateStyle } from './layout-box.mjs';
import { fitCommandPrefix } from './root-command-layout.mjs';

const searchMinimum = 160;
const preferredSearchWidth = 172;

/** Measure the preferred pass with every button mounted, then fit the same owners on resize. */
export function measureTableCommands(root, scale) {
  const bars = [...root.querySelectorAll('.taxi-table-command-bar[data-adaptive-table-toolbar]')].map(bar => {
    const commands = [...bar.querySelectorAll(':scope > :is([data-command-key], [data-table-search-control], .taxi-element)')];
    const search = !!bar.querySelector(':scope > .taxi-table-search');
    const more = bar.querySelector(':scope > [data-table-more]');
    const button = more.querySelector(':scope > button');
    const gap = pixels(getComputedStyle(bar).columnGap);
    const widths = commands.map(command => borderBoxSize(command, scale).width);
    const moreWidth = borderBoxSize(button, scale).width;
    return { bar, commands, widths, more, moreWidth, search, gap };
  });
  return () => {
    for (const { bar, commands, widths, more, moreWidth, search, gap } of bars) {
      const available = borderBoxSize(bar, scale).width;
      const tail = moreWidth + (search ? searchMinimum + gap : 0);
      const showMore = !search || available >= tail;
      const visible = showMore ? fitCommandPrefix(widths, available, tail, gap) : 0;
      more.toggleAttribute('data-table-command-hidden', !showMore);
      commands.forEach((command, index) => command.toggleAttribute('data-table-command-hidden', index >= visible));
      const searchOnly = search && visible === 0;
      bar.toggleAttribute('data-table-search-only', searchOnly);
      if (searchOnly) {
        // Without leading commands the spacer shares the surplus past the preferred search width.
        const surplus = available - (showMore ? moreWidth + gap : 0) - preferredSearchWidth;
        const inset = Math.floor(Math.max(0, surplus) / 10);
        const extra = Number(inset > 0);
        updateStyle(bar, '--taxi-table-search-leading', `${inset}px`);
        updateStyle(bar, '--taxi-table-more-width', `${moreWidth + extra}px`);
        updateStyle(bar, '--taxi-table-more-caption-offset', `${-extra}px`);
      }
    }
  };
}
