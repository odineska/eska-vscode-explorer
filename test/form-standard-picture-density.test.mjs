import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectStandardPictureDensity, standardPicturePixelScale } from '../webview/forms/standard-picture-density.mjs';
import { webStandardPictures } from '../webview/forms/web-standard-pictures.mjs';
import { standardPicture } from '../webview/forms/standard-pictures.mjs';

test('choice picture canvases derive their physical size from zoom and display density', () => {
  for (const [zoom, ratio, expected] of [[75, 1, .75], [125, 1.2, 1.5], [150, 2, 3]]) {
    assert.equal(standardPicturePixelScale(zoom, ratio), expected);
  }
  assert.equal(standardPicturePixelScale(100, 2), undefined);
  assert.equal(standardPicturePixelScale(100, 2, true), 2);
  assert.equal(standardPicturePixelScale(125, 1.2, true), 1.5);
  assert.equal(standardPicturePixelScale(125, NaN), undefined);
});

test('the nine baseline command drawings have distinct owned SVG sources', () => {
  const names = ['CheckAll', 'DeleteListItemDirectly', 'EventLog', 'ExchangePlan', 'MoveLeft',
    'OpenFile', 'Post', 'Refresh', 'UncheckAll'];
  assert.deepEqual(Object.keys(webStandardPictures).sort(), names);
  const sources = names.map(name => standardPicture(name).source);
  assert.equal(new Set(sources).size, names.length);
  assert.ok(sources.every(source => source.startsWith('data:image/svg+xml,')));
});

test('density selection uses physical scale, with a slight preference for the denser image', () => {
  const densities = [85, 100, 125, 150, 175, 200, 300, 400];
  for (const [zoom, ratio, expected] of [[50, 1, 85], [93, 1, 100], [100, 1.1, 100],
    [100, 1.12, 125], [75, 2, 150], [100, 2, 200], [100, 5, 400]]) {
    assert.equal(selectStandardPictureDensity(densities, zoom, ratio), expected);
  }
  for (const ratio of [0, -1, NaN, Infinity]) {
    assert.equal(selectStandardPictureDensity(densities, 100, ratio), undefined);
  }
});
