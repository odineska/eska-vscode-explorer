import assert from 'node:assert/strict';
import { test } from 'node:test';
import { standardPicture } from '../webview/forms/standard-pictures.mjs';

const standardNames = [
  'Parameters', 'MoveLeft', 'OpenFile', 'MoveUp', 'MoveDown', 'CloneListItem', 'CloneObject',
  'Find', 'SearchControl', 'Refresh', 'Post', 'EventLog', 'CheckAll', 'UncheckAll',
  'DeleteListItemDirectly', 'ExchangePlan', 'PostAndClose', 'Write', 'MarkObjectForDeletion',
  'UndoPosting', 'ShowInList', 'ChangeHistory', 'CustomizeForm', 'Help', 'Create', 'Change',
  'CancelSearch', 'GetCurrentRowURL', 'ListSettings', 'SelectSettings', 'SaveSettings',
  'OutputList', 'SetPeriod', 'DeleteListItem', 'CreateFolder', 'ViewMode', 'MoveItem',
  'LevelDown', 'LevelUp', 'HierarchicalList', 'List', 'Tree',
];

const tableMenuNames = [
  'Add', 'MoveUp', 'MoveDown', 'Copy', 'Delete', 'Change', 'EndEdit',
  'SortListAsc', 'SortListDesc', 'SortListAscEn', 'SortListDescEn',
  'OutputList', 'AdvancedSearch', 'CancelSearch',
];

function verifyVector(picture, name) {
  assert.ok(picture, name);
  assert.deepEqual([picture.width, picture.height], [16, 16], name);
  assert.match(picture.source, /^data:image\/svg\+xml,/);
  const svg = decodeURIComponent(picture.source.slice(picture.source.indexOf(',') + 1));
  assert.match(svg, /^<svg [^>]+viewBox="0 0 16 16"[^>]*>.*<\/(?:svg)>$/s);
  assert.match(svg, /<(?:path|rect|circle) /);
  assert.doesNotMatch(svg, /<image|<use|<script|\.png|href=/i);
  return picture.source;
}

test('standard picture names retain their 16-pixel slots and drawing semantics', () => {
  for (const name of standardNames) {
    const picture = standardPicture(name);
    verifyVector(picture, name);
    assert.equal(standardPicture(`StdPicture.${name}`), picture);
    assert.equal(standardPicture(name, 'tableMenu'), picture);
    assert.equal(picture.isTemplate, name === 'GetCurrentRowURL');
  }
  assert.equal(standardPicture('Find').source, standardPicture('SearchControl').source);
  assert.notEqual(standardPicture('CloneObject').source, standardPicture('CloneListItem').source);
  for (const name of ['Copy', 'Unknown', 'PrefixMoveUp', 'MoveUpSuffix', 'constructor', null]) {
    assert.equal(standardPicture(name), undefined);
  }
});

test('ordinary table menu provides 14 distinct vector drawings including both alphabets', () => {
  const sources = tableMenuNames.map(name => verifyVector(standardPicture(name, 'tableActionMenu'), name));
  assert.equal(new Set(sources).size, tableMenuNames.length);
  assert.equal(standardPicture('Unknown', 'tableActionMenu'), undefined);
  assert.equal(standardPicture('constructor', 'tableActionMenu'), undefined);
});

test('automatic table movement reuses the same direction drawings as ordinary table menus', () => {
  for (const name of ['MoveUp', 'MoveDown']) {
    assert.equal(standardPicture(name, 'tableCommand').source, standardPicture(name, 'tableActionMenu').source);
  }
  assert.equal(standardPicture('OpenFile', 'tableCommand'), undefined);
});

test('bundled rasters are scoped to the verified picture variants and keep logical size', () => {
  const root = 'https://preview.example/resources/forms/jet/';
  const raster = (name, variant, zoom = 100, pixelRatio = 1) =>
    standardPicture(name, variant, { root, zoom, pixelRatio });
  for (const [zoom, ratio, density] of [[75, 1, 85], [100, 1, 100], [125, 1, 125],
    [100, 1.5, 150], [175, 1, 175], [100, 2, 200], [150, 2, 300], [200, 2, 400]]) {
    const post = raster('StdPicture.Post', 'standard', zoom, ratio);
    assert.deepEqual(post, {
      width: 16, height: 16, source: root + `PublishFile/${density}.png`,
      isRaster: true, isTemplate: false,
    });
    const deletion = raster('StdPicture.MarkObjectForDeletion', 'tableMenu', zoom, ratio);
    assert.deepEqual(deletion, {
      width: 16, height: 16, source: root + 'UserTemplateDelete/100.png',
      isRaster: true, isTemplate: false,
    });
  }
  assert.equal(raster('Post', 'tableMenu'), standardPicture('Post', 'tableMenu'));
  assert.equal(raster('MarkObjectForDeletion', 'standard'), standardPicture('MarkObjectForDeletion'));
  assert.equal(raster('MarkObjectForDeletion', 'tableActionMenu'), undefined);
  assert.equal(raster('Post', 'tableActionMenu'), undefined);
  assert.equal(raster('Post', 'tableCommand'), undefined);
  assert.equal(raster('MoveUp', 'tableCommand'), standardPicture('MoveUp', 'tableCommand'));
});
