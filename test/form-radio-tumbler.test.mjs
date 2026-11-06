import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createFontRaster } from '../webview/forms/font-raster.mjs';
import { paintRadioTumbler, radioTumblerLayout } from '../webview/forms/radio-tumbler.mjs';
import { inactiveTumblerTextColor } from '../webview/forms/tumbler-caption.mjs';

test('Linux radio tumblers match the complete native segments, shared edges and captions', async () => {
  const cases = [
    {"labels": ["Update", "Skip"], "columns": 2, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [106, 24],
      "sha256": "f0b7a8ee6c0de7ea300ab940e569c87fb3fb5035b40be467b9ff599982dbc606"},
    {"labels": ["Update", "Skip"], "columns": 2, "points": 10, "weight": 400, "foreground": [128, 128, 128], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [106, 24],
      "sha256": "3a280b83763b1e4f1f9ce31c92d69c31689205d2c724b9031fd9017e9a7847ad"},
    {"labels": ["Update", "Skip"], "columns": 2, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [106, 24],
      "sha256": "f0b7a8ee6c0de7ea300ab940e569c87fb3fb5035b40be467b9ff599982dbc606"},
    {"labels": ["Skip", "Update"], "columns": 2, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [106, 24],
      "sha256": "34b079b2b3288e05a1a5a1989156e191256290958ec99755214b7641d57d88dd"},
    {"labels": ["Update", "Update"], "columns": 2, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [121, 24],
      "sha256": "98b982a45e5f01a96ff164ec362886c758f45ca75ca62836197f7228165e1548"},
    {"labels": ["A", "A much longer option"], "columns": 2, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [171, 24],
      "sha256": "bf011cabd0804cd5c880742980a8e94a1ce2966c4c156400f92342cbeac82973"},
    {"labels": ["Update", "Skip"], "columns": 2, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [106, 24],
      "sha256": "f0b7a8ee6c0de7ea300ab940e569c87fb3fb5035b40be467b9ff599982dbc606"},
    {"labels": ["Update", "Skip"], "columns": 1, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [61, 46],
      "sha256": "a1a6e52bce69d9538af80630321c9ceb8d42f08dfedd39eef432354ca63ecb33"},
    {"labels": ["First", "Second long", "Third", "Fourth", "Fifth"], "columns": 3, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [196, 46],
      "sha256": "37a7e0cfc223491ad818a32f1e4deb34273cdb85b1c94703478c2a5b8437be23"},
    {"labels": ["Обновлять", "Пропускать"], "columns": 1, "points": 16, "weight": 700, "foreground": [0, 0, 255], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [155, 74],
      "sha256": "07073e9436f6393b52f0ab3717e69df1fb9dbea4e27bf2e9c8e16e7b51a780c6"},
    {"labels": ["First", "Second long", "Third", "Fourth", "Fifth", "Sixth", "Seventh"], "columns": 3, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [208, 69],
      "sha256": "3aa517d55b9b189c11217736a43eae720bc37555a58254edb3f346e35ec451b6"},
    {"labels": ["First", "Second long", "Third", "Fourth"], "columns": 3, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [196, 46],
      "sha256": "0fdca40e2132c305606c9fd4ed7b0cdedc8f5f0ccb8e07b743932ca09f8c2794"},
    {"labels": ["Да", "Широкий вариант", "Третья кнопка", "Четвёртая", "Пятая"], "columns": 2, "points": 16, "weight": 700, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [402, 111],
      "sha256": "22730c965f7593aa8a730950aba2e39ea0cb953239366aac3082b457b0e440be"},
    {"labels": ["Update", "Skip", "More"], "columns": 2, "points": 10, "weight": 400, "foreground": [255, 0, 0], "fill": [144, 238, 144], "stroke": [0, 0, 255], "backdrop": [255, 255, 255], "inactive": false, "dimensions": [106, 46],
      "sha256": "7238b179d2abd86542cc3cf62e17df5e81da8663325675d29a1e22e5de10fafc"},
    {"labels": ["Update", "Skip", "More"], "columns": 2, "points": 10, "weight": 400, "foreground": [255, 0, 0], "fill": [144, 238, 144], "stroke": [0, 0, 255], "backdrop": [255, 255, 255], "inactive": true, "dimensions": [106, 46],
      "sha256": "d8f9922354257dd078948952ad6dffe2f21d245b5bcbadbe7b5f8767e64375ae"},
    {"labels": ["Update", "Skip", "More"], "columns": 2, "points": 10, "weight": 400, "foreground": [255, 0, 0], "fill": [144, 238, 144], "stroke": [0, 0, 255], "backdrop": [255, 255, 255], "inactive": true, "dimensions": [106, 46],
      "sha256": "d8f9922354257dd078948952ad6dffe2f21d245b5bcbadbe7b5f8767e64375ae"},
    {"labels": ["First", "Second long", "Third", "Fourth", "Fifth", "Sixth", "Seventh"], "columns": 3, "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "backdrop": [0, 0, 0], "inactive": false, "dimensions": [208, 69],
      "sha256": "9b6e19e73467cf3a8d608856402a620f10afc669c831a78607fa839cda070b81"},
  ];
  const resource = name => readFile(new URL(`../resources/forms/${name}`, import.meta.url));
  const engine = createFontRaster(await resource('native-text/font-raster.wasm'));
  try {
    const faces = {
      400: engine.open(await resource('fonts/LiberationSans-Regular.ttf')),
      700: engine.open(await resource('fonts/LiberationSans-Bold.ttf')),
    };
    for (const row of cases) {
      const font = { points: row.points, weight: row.weight };
      const layout = radioTumblerLayout(row.labels,row.columns,font);
      assert.deepEqual([layout.width, layout.height], row.dimensions, row.labels.join(' / '));
      const foreground = row.inactive ? inactiveTumblerTextColor(row.foreground, row.fill) : row.foreground;
      const image = paintRadioTumbler(layout, font, faces[row.weight], row, foreground);
      assert.equal(createHash('sha256').update(image.rgba).digest('hex'), row.sha256, row.labels.join(' / '));
    }
  } finally { engine.dispose(); }
});
