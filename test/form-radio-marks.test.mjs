import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { radioGlyph } from '../webview/forms/choice-glyph.mjs';
import { inactiveRadioTextColor } from '../webview/forms/choice-colors.mjs';

test('Linux radio circles match native selected and unselected marks on all measured backdrops', () => {
  const samples = [
    {"name": "White", "selected": true, "inactive": false, "backdrop": [255, 255, 255], "rgbaSha256": "3743ea24120bc04b11630fabc1458119a8759ef589e5ce53ac4e662f3113d07e"},
    {"name": "White", "selected": false, "inactive": false, "backdrop": [255, 255, 255], "rgbaSha256": "01511f7e1ef69ea6ab67d100c894b2238c41dbfc2b0adca63c094f4280eecfdf"},
    {"name": "Black", "selected": true, "inactive": false, "backdrop": [0, 0, 0], "rgbaSha256": "9d9f5b730562fe6407cd43c914aa0475b6ccc81a889e3d81b7907d8508147713"},
    {"name": "Black", "selected": false, "inactive": false, "backdrop": [0, 0, 0], "rgbaSha256": "14735fb5dc4632a7aad8de5152eb10a47e48d60e472a02d6b5992113de06304a"},
    {"name": "BlueParent", "selected": true, "inactive": false, "backdrop": [34, 102, 204], "rgbaSha256": "da2e7060787e453218ef569de34b8286c3a2f50ffeda4b39a720da701ae91633"},
    {"name": "BlueParent", "selected": false, "inactive": false, "backdrop": [34, 102, 204], "rgbaSha256": "cf617e35974a4d59b564b3bd9db77e831dfa17cb9eea3adcfc56ddbb63a6ad9e"},
    {"name": "DisabledWhite", "selected": true, "inactive": true, "backdrop": [255, 255, 255], "rgbaSha256": "5e386c042b8c28a8aeb98951931abd56c444f89587126557a5123cd426fe03c9"},
    {"name": "DisabledWhite", "selected": false, "inactive": true, "backdrop": [255, 255, 255], "rgbaSha256": "6c710aae1722905e05c597c7f8bfa67d64d366ecbbcc099ab13914f2a8f99e96"},
    {"name": "DisabledBlack", "selected": true, "inactive": true, "backdrop": [0, 0, 0], "rgbaSha256": "9f8ad32a9f1760b7631476c86f2a06a5a5870fd73ec829c19d8e220d623f13d5"},
    {"name": "DisabledBlack", "selected": false, "inactive": true, "backdrop": [0, 0, 0], "rgbaSha256": "ce076d7dde79a435be421a068301555f933a155b96d95784a15d79d4b1ae00ee"},
    {"name": "ReadOnly", "selected": true, "inactive": true, "backdrop": [255, 255, 255], "rgbaSha256": "5e386c042b8c28a8aeb98951931abd56c444f89587126557a5123cd426fe03c9"},
    {"name": "ReadOnly", "selected": false, "inactive": true, "backdrop": [255, 255, 255], "rgbaSha256": "6c710aae1722905e05c597c7f8bfa67d64d366ecbbcc099ab13914f2a8f99e96"},
    {"name": "Paint", "selected": true, "inactive": false, "backdrop": [255, 255, 255], "rgbaSha256": "3743ea24120bc04b11630fabc1458119a8759ef589e5ce53ac4e662f3113d07e"},
    {"name": "Paint", "selected": false, "inactive": false, "backdrop": [255, 255, 255], "rgbaSha256": "01511f7e1ef69ea6ab67d100c894b2238c41dbfc2b0adca63c094f4280eecfdf"},
    {"name": "Bold", "selected": true, "inactive": false, "backdrop": [255, 255, 255], "rgbaSha256": "3743ea24120bc04b11630fabc1458119a8759ef589e5ce53ac4e662f3113d07e"},
    {"name": "Bold", "selected": false, "inactive": false, "backdrop": [255, 255, 255], "rgbaSha256": "01511f7e1ef69ea6ab67d100c894b2238c41dbfc2b0adca63c094f4280eecfdf"},
  ];
  for (const row of samples) {
    const { width, height, rgba } = radioGlyph(row.selected, row.inactive, row.backdrop);
    assert.deepEqual([width,height],[15,15],row.name);
    assert.equal(createHash('sha256').update(rgba).digest('hex'),row.rgbaSha256,row.name);
  }
});

test('Linux ordinary radio inactive captions mix the resolved text and backdrop colors', () => {
  const colors = [
    [[77, 77, 77], [255, 255, 255], [166, 166, 166]],
    [[0, 0, 0], [255, 255, 255], [128, 128, 128]],
    [[255, 255, 255], [255, 255, 255], [255, 255, 255]],
    [[128, 128, 128], [255, 255, 255], [192, 192, 192]],
    [[255, 0, 0], [255, 255, 255], [255, 128, 128]],
    [[34, 102, 204], [255, 255, 255], [134, 172, 230]],
    [[144, 238, 144], [255, 255, 255], [198, 247, 198]],
    [[255, 102, 0], [255, 255, 255], [255, 179, 128]],
    [[77, 77, 77], [255, 255, 255], [166, 166, 166]],
    [[77, 77, 77], [0, 0, 0], [103, 103, 103]],
    [[77, 77, 77], [34, 102, 204], [154, 154, 154]],
    [[77, 77, 77], [144, 238, 144], [162, 162, 162]],
    [[77, 77, 77], [128, 128, 128], [135, 135, 135]],
    [[77, 77, 77], [32, 32, 32], [111, 111, 111]],
    [[77, 77, 77], [255, 102, 0], [166, 166, 166]],
    [[77, 77, 77], [255, 0, 0], [166, 166, 166]],
    [[255, 0, 0], [0, 0, 0], [192, 96, 96]],
    [[255, 0, 0], [34, 102, 204], [243, 71, 71]],
    [[34, 102, 204], [144, 238, 144], [109, 156, 226]],
    [[144, 238, 144], [128, 128, 128], [173, 215, 173]],
    [[0, 0, 0], [34, 102, 204], [115, 115, 115]],
    [[128, 128, 128], [144, 238, 144], [188, 188, 188]],
    [[77, 77, 77], [0, 0, 0], [103, 103, 103]],
    [[255, 0, 0], [34, 102, 204], [243, 71, 71]],
  ];
  for (const [foreground, backdrop, expected] of colors) {
    assert.deepEqual(inactiveRadioTextColor(foreground,backdrop),expected,`${foreground} over ${backdrop}`);
  }
});
