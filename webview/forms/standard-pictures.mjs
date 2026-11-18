import { selectStandardPictureDensity } from './standard-picture-density.mjs';
import { webStandardPictures } from './web-standard-pictures.mjs';
import { webTableMenuPictures } from './web-table-menu-pictures.mjs';

const { Add, CancelSearch, Change, Copy, EndEdit, MoveDown, MoveUp, OutputList } = webTableMenuPictures;
const search = '<circle cx="6.5" cy="6.5" r="4" stroke="#276aa0"/><path d="m9.5 9.5 4 4" stroke="#276aa0"/>';
const settings = '<path d="M2 4h12M2 8h12M2 12h12"/><path d="M5 2.5v3m5 1v3m-4 1v3" stroke="#276aa0" stroke-width="2.5"/>';
const folder = '<path d="M2 4h4l1.5 2H14v7H2z" stroke="#986522"/>';
const list = '<path d="M5 4h8M5 8h8M5 12h8M2 4h.1M2 8h.1M2 12h.1"/>';
const tree = '<path d="M3 3v9h4M3 7h4m2 0h4m-4 5h4M6 3h7"/>';
const save = '<path d="M3 2h8.5L13 3.5V14H3zM6 2v4h4V2M6 14v-4h4v4" stroke="#276aa0"/>';
const horizontalArrow = '<path d="M2 4h6M2 12h6m-2-4h8m-2-2 2 2-2 2" stroke="#276aa0"/>';
const calendar = '<rect x="2.5" y="4" width="11" height="9.5" rx="1"/><path d="M2.5 7h11M5.5 2.5v3m5-3v3M5 10h3" stroke="#276aa0"/>';

const pictures = {
  ...webStandardPictures,
  Parameters: settings,
  MoveUp, MoveDown,
  CloneListItem: Copy,
  CloneObject: '<rect x="5" y="5" width="8.5" height="8.5" rx="1"/><path d="M3 10V3h7m-3.5 6h5" stroke="#276aa0"/>',
  Find: search,
  SearchControl: search,
  PostAndClose: EndEdit + '<path d="M3 5V2h10v2m0 5v5H3v-2"/>',
  Write: save,
  MarkObjectForDeletion: '<path d="M4 14V2h8l-2.5 3L12 8H4" stroke="#ab453f"/>',
  UndoPosting: '<path d="M4 5h5a4 4 0 0 1 0 8H6M6 2 3 5l3 3" stroke="#ab453f"/>',
  ShowInList: list + '<path d="M5 8h8" stroke="#168078" stroke-width="2.5"/>',
  ChangeHistory: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.5 1.5" stroke="#276aa0"/>',
  CustomizeForm: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6h12M6 6v7M8 9h4" stroke="#276aa0"/>',
  Help: '<path d="M5.3 5a2.7 2.7 0 1 1 4.2 2.2C8.5 8 8 8.7 8 9.5m0 3h.1" stroke="#276aa0" stroke-width="1.8"/>',
  Create: Add,
  Change, CancelSearch,
  GetCurrentRowURL: '<path d="m6 10 4-4M5 9l-1 1a2 2 0 0 0 3 3l2-2M7 5l2-2a2 2 0 0 1 3 3l-1 1"/>',
  ListSettings: settings,
  SelectSettings: folder + '<path d="m5.5 9 1.5 1.5L10 8" stroke="#168078"/>',
  SaveSettings: save + '<path d="M1.5 8h13" stroke="#168078"/>',
  OutputList,
  SetPeriod: calendar,
  Calendar: calendar,
  DeleteListItem: webTableMenuPictures.Delete,
  CreateFolder: folder + '<path d="M8 8v3M6.5 9.5h3" stroke="#168078"/>',
  ViewMode: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M7 3v10M9 6h3m-3 4h3"/>',
  MoveItem: '<path d="M2 3h6v4H2zm6 6h6v4H8zM3 9v2h3" stroke="#276aa0"/>',
  LevelDown: horizontalArrow,
  LevelUp: `<g transform="translate(16 0) scale(-1 1)">${horizontalArrow}</g>`,
  HierarchicalList: tree + '<path d="M6 3h7" stroke="#168078" stroke-width="2"/>',
  List: list,
  Tree: tree,
};

function pictureMap(artwork) {
  return Object.fromEntries(Object.entries(artwork).map(([name, body]) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#425668" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
    return [name, {
      width: 16,
      height: 16,
      source: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      isTemplate: name === 'GetCurrentRowURL',
    }];
  }));
}

const standard = pictureMap(pictures);
const tableActionMenu = pictureMap(webTableMenuPictures);

export function standardPicture(name, variant = 'standard', rasterContext) {
  if (typeof name !== 'string') return;
  const key = name.replace(/^StdPicture\./, '');
  if (variant === 'tableActionMenu') {
    return Object.hasOwn(tableActionMenu, key) ? tableActionMenu[key] : undefined;
  }
  if (variant === 'tableCommand' && key !== 'MoveUp' && key !== 'MoveDown') return;
  if (['standard', 'tableMenu', 'tableCommand'].includes(variant) && Object.hasOwn(standard, key)) {
    if (rasterContext?.root) {
      const family = variant === 'standard' && key === 'Post' ? 'PublishFile'
        : variant === 'tableMenu' && key === 'MarkObjectForDeletion' ? 'UserTemplateDelete' : undefined;
      if (family) {
        const { root, zoom, pixelRatio } = rasterContext;
        const density = family === 'PublishFile'
          ? selectStandardPictureDensity([85, 100, 125, 150, 175, 200, 300, 400], zoom, pixelRatio) : 100;
        if (density) return { ...standard[key], source: `${root}${family}/${density}.png`, isRaster: true };
      }
    }
    return standard[key];
  }
}
