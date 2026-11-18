const glyphs = {
  dropdown: { width: 7, height: 5, fill: 'M0 0.75h7L3.5 4.5z' },
  choice: { width: 9, height: 3, fill: 'M0 1h2v2H0z M3.5 1h2v2h-2z M7 1h2v2H7z' },
  clear: { width: 9, height: 9, stroke: 'M1.5 1.5l6 6m0-6-6 6' },
  open: { width: 11, height: 11, stroke: 'M3.5 3.5v-3h7v7h-3 M0.5 3.5h7v7h-7z' },
  calendar: { width: 11, height: 11, stroke: 'M1 2.5h9v8H1z M1 5h9 M3.5 0.75V3.5 M7.5 0.75V3.5', fill: 'M3 7h1.5v1.5H3z M6.5 7H8v1.5H6.5z' },
  calculator: { width: 9, height: 11, stroke: 'M1 0.75h7v9.5H1z M1 4h7', fill: 'M2.5 5.25H4v1.5H2.5z M5 5.25h1.5v1.5H5z M2.5 7.75H4v1.5H2.5z M5 7.75h1.5v1.5H5z' },
  'spin-up': { width: 5, height: 3, fill: 'M0 3L2.5 0l2.5 3z' },
  'spin-down': { width: 5, height: 3, fill: 'M0 0h5L2.5 3z' },
};

export function inputButtonGlyphs(kind) {
  const roles = kind === 'spin' ? ['spin-up', 'spin-down'] : [kind];
  return roles.map(role => ({ role, ...glyphs[role] }));
}
