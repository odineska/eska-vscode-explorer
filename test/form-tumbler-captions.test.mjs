import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { checkboxTumblerLayout } from '../webview/forms/checkbox-model.mjs';
import { createFontRaster } from '../webview/forms/font-raster.mjs';
import { FORM_NS } from '../webview/forms/model.mjs';
import { inactiveTumblerTextColor } from '../webview/forms/choice-colors.mjs';
import { paintTumblerCaptions } from '../webview/forms/tumbler-caption.mjs';
import { tumblerPaint } from '../webview/forms/tumbler-paint.mjs';

test('Linux tumbler option text matches complete native rasters with kerning, wrapping and clipping', async () => {
  const cases = [
    {"labels": ["Yes", "No"], "properties": {}, "dimensions": [81, 24, 39], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "645a5657eb03f61c95643afae093c4b795320abd0238e1c53cf15c89558c07a0"},
    {"labels": [" Yes; really", "No"], "properties": {}, "dimensions": [167, 24, 82], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "4f589afd340f48b7d3820a5ea7f9ab038be22c93036b8f45e0b5364afa138f4b"},
    {"labels": ["Off", "True"], "properties": {"EqualItemsWidth": "false"}, "dimensions": [81, 24, 35], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "37f13b0e7954d1494fc11612c41c025f511b613cdfe2a54ffb7229546a82bce7"},
    {"labels": ["Истина", "Ложь"], "properties": {}, "dimensions": [125, 24, 61], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "8e642348eb44e72fe915ad4e1eb202263ffe09ddef0212dcfe29086e559c63f6"},
    {"labels": ["Вкл", "Выключено"], "properties": {"EqualItemsWidth": "false"}, "dimensions": [131, 24, 41], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "6c8f5a4e6fb965d621050aa2020820236a45a2b6d65ebc5c3079984ee361f3ab"},
    {"labels": ["On", "Off"], "properties": {"ItemWidth": 12, "ItemHeight": 2}, "dimensions": [243, 46, 120], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "c7c554fa06955018c53628fc888ba8c9842420e89642c1740b2dc5ef6af7f8e3"},
    {"labels": ["Истина", "Ложь"], "properties": {}, "dimensions": [213, 38, 105], "points": 16, "weight": 700, "foreground": [255, 0, 0], "fill": [144, 238, 144], "stroke": [0, 0, 255], "inactive": false,
      "sha256": "0b427cd914c2d3179723796f8b7c10c17a415c6dee148210bd24c0b18f806751"},
    {"labels": ["Истина", "Ложь"], "properties": {}, "dimensions": [125, 24, 61], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": true,
      "sha256": "85d59b1dd38637b8602bfa20995e40197327424cfc61922a17fb5118d64a062b"},
    {"labels": ["Истина", "Ложь"], "properties": {"ItemWidth": 3}, "dimensions": [63, 24, 30], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "a4a56b557aaeb828333a8e316288f8df8e56705e47d3fc6fc4d162f64eb684b1"},
    {"labels": ["Very long short", "Two lines here"], "properties": {"ItemWidth": 3, "ItemHeight": 2, "ItemTitleHeight": 2}, "dimensions": [63, 46, 30], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "effa90787b8c16ae8b280b1c70c7434ece1b6410498dec8fe066aa7ffc7f0f4c"},
    {"labels": ["Long custom single phrase", "Small"], "properties": {"ItemWidth": 4, "ItemTitleHeight": 3}, "dimensions": [83, 54, 40], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "153bb6c03947561b63135a3408809bafc78e4095670ea1aebc396d14bbffdf31"},
    {"labels": ["One\nTwo\nThree", "Short"], "properties": {"ItemWidth": 6, "ItemHeight": 1, "ItemTitleHeight": 1}, "dimensions": [123, 23, 60], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "36167a5a9deaca04fe236f37319e977212596ed90271d997110d30a111f2accc"},
    {"labels": ["One\nTwo\nThree", "Short"], "properties": {"ItemWidth": 6}, "dimensions": [123, 54, 60], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "6daa8369dce459ad7d961d8d5bd1db951f5b6093c1b5acc2d3f6f8a58c92d138"},
    {"labels": ["Avalanche", "AVA pop-up"], "properties": {"ItemWidth": 8}, "dimensions": [163, 24, 80], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "b12542553550b2932ea3bd04a000f7b13e8404a12d6ec03f972cf6f6417e3226"},
    {"labels": ["XXX", "ШШШ"], "properties": {"ItemWidth": 6}, "dimensions": [123, 24, 60], "points": 10, "weight": 400, "foreground": [255, 0, 0], "fill": [144, 238, 144], "stroke": [160, 160, 160], "inactive": true,
      "sha256": "9ec769f7f7cd1e22627ceafc951c544fe428d1fd7d5e794929b0730e0d9cc5a9"},
    {"labels": ["True", "False"], "properties": {}, "dimensions": [103, 24, 50], "points": 10, "weight": 400, "foreground": [77, 77, 77], "fill": [255, 255, 255], "stroke": [160, 160, 160], "inactive": false,
      "sha256": "78c66e63abbb9b542b72d1a9850f51ce9187ffc7261e3c4639b8edcb80ce507b"},
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
      const properties = Object.entries(row.properties).map(([name, value]) => ({
        key: { namespace: FORM_NS, name }, value: { kind: 'text', text: String(value) },
      }));
      const layout = checkboxTumblerLayout({ properties, presentation: { font } }, row.labels, 'linux');
      assert.deepEqual([layout.width, layout.height, layout.first], row.dimensions, row.labels.join(' / '));
      const image = tumblerPaint({ ...layout, fill: row.fill, stroke: row.stroke, backdrop: [255, 255, 255] });
      const foreground = row.inactive ? inactiveTumblerTextColor(row.foreground, row.fill) : row.foreground;
      paintTumblerCaptions(image, layout.segments, font, faces[row.weight], foreground);
      assert.equal(createHash('sha256').update(image.rgba).digest('hex'), row.sha256, row.labels.join(' / '));
    }
  } finally { engine.dispose(); }
});
