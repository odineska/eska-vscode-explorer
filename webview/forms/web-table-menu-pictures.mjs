const sortLetters = {
  A: 'M2 6l1.5-4L5 6M2.5 5h2',
  Z: 'M2 2h3L2 6h3',
  А: 'M2 6l1.5-4L5 6M2.5 5h2',
  Я: 'M5 6V2H3a1 1 0 0 0 0 2h2M3 4 2 6',
};

function sort(first, last) {
  return `<path d="${sortLetters[first]}"/>
    <path d="${sortLetters[last]}" transform="translate(0 8)"/>
    <path d="M10.5 3v10m-2.5-2.5 2.5 2.5 2.5-2.5" stroke="#168078"/>`;
}

export const webTableMenuPictures = {
  Add: '<path d="M8 3v10M3 8h10" stroke="#168078" stroke-width="2"/>',
  MoveUp: '<path d="M8 13V3m-4 4 4-4 4 4" stroke="#276aa0" stroke-width="2"/>',
  MoveDown: '<path d="M8 3v10m-4-4 4 4 4-4" stroke="#276aa0" stroke-width="2"/>',
  Copy: '<rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10V3h7" stroke="#276aa0"/>',
  Delete: '<path d="M3 4h10M6 4V2h4v2M4.5 4l.8 9h5.4l.8-9M7 6.5v4m2-4v4" stroke="#ab453f"/>',
  Change: '<path d="m3 10 7.5-7.5 3 3L6 13H3zM9 4l3 3" stroke="#276aa0"/>',
  EndEdit: '<path d="M3 8l3.3 3.3L13 4.5" stroke="#168078" stroke-width="2"/>',
  SortListAsc: sort('А', 'Я'),
  SortListDesc: sort('Я', 'А'),
  SortListAscEn: sort('A', 'Z'),
  SortListDescEn: sort('Z', 'A'),
  OutputList: '<path d="M2 3h7M2 6.5h7M2 10h4m3 0h5m-2.5-2.5L14 10l-2.5 2.5" stroke="#276aa0"/>',
  AdvancedSearch: '<circle cx="6.5" cy="6.5" r="4" stroke="#276aa0"/><path d="m9.5 9.5 4 4M4.7 6.5h3.6M6.5 4.7v3.6" stroke="#276aa0"/>',
  CancelSearch: '<circle cx="6" cy="6" r="3.5"/><path d="m8.5 8.5 1.5 1.5m1 1 3 3m0-3-3 3" stroke="#ab453f"/>',
};
