import assert from 'node:assert/strict';
import { test } from 'node:test';
import { standardPicturePixelScale } from '../webview/forms/standard-picture-density.mjs';
import { webStandardPictures } from '../webview/forms/web-standard-pictures.mjs';
import { standardPicture } from '../webview/forms/standard-pictures.mjs';

test('choice picture canvases derive their physical size from zoom and display density', () => {
  for (const [zoom, ratio, expected] of [[75, 1, .75], [125, 1.2, 1.5], [150, 2, 3]]) {
    assert.equal(standardPicturePixelScale(zoom, ratio), expected);
  }
  assert.equal(standardPicturePixelScale(100, 2), undefined);
  assert.equal(standardPicturePixelScale(125, NaN), undefined);
});

test('the nine standard command drawings share vector sources across representation sizes', () => {
  const names = ['CheckAll', 'DeleteListItemDirectly', 'EventLog', 'ExchangePlan', 'MoveLeft',
    'OpenFile', 'Post', 'Refresh', 'UncheckAll'];
  assert.deepEqual(Object.keys(webStandardPictures).sort(), names);
  const sources = names.map(name => standardPicture(name).source);
  assert.equal(new Set(sources).size, names.length);
  assert.ok(sources.every(source => source.startsWith('data:image/svg+xml,')));
});
