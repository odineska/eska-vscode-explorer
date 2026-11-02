/** Small, original line icons inherit the host theme's foreground. */
export const iconPaths = {
  add: ['M8 2v12M2 8h12'],
  remove: ['M3 3l10 10M13 3L3 13'],
  edit: ['M3 10l7-7 3 3-7 7H3zM9 4l3 3'],
  up: ['M3 9l5-5 5 5M8 4v9'],
  down: ['M3 7l5 5 5-5M8 3v9'],
  right: ['M5 3l5 5-5 5'],
  left: ['M10 3L5 8l5 5'],
  copy: ['M6 2h7v9H6zM3 5v9h7'],
  locate: ['M5 2H2v12h3M11 2h3v12h-3M5 8h6M8 5l3 3-3 3'],
  nested: ['M2 3h5v5H2zM9 8h5v5H9zM5 8v3h4'],
  all: ['M2 3l5 5-5 5M8 3l5 5-5 5']
};

export function iconElement(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 16 16'); svg.setAttribute('aria-hidden','true');
  for (const d of iconPaths[name] ?? []) {
    const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',d); svg.append(path);
  }
  return svg;
}
