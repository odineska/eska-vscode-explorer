const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runGallery } = require('./form-input-pixels-host.cjs');
const { until } = require('./webview-host.cjs');

exports.run = () => runGallery({
  fixtureKey: 'choicePictures',
  prefix: 'choice-pictures',
  reportKey: 'choicePictures',
  verifyFrame: true,
  fullScreen: true,
  async beforeSample({ui, expected, label}) {
    const inspect = `(() => {
      const root = document.querySelector('.taxi-form-frame').getBoundingClientRect();
      return [...document.querySelectorAll('.taxi-input')].map(input => {
        const buttons = [...input.querySelectorAll(':scope > .taxi-input-button')];
        const picture = input.querySelector('.taxi-input-choice-picture')?.getBoundingClientRect();
        return {
          kinds: buttons.map(button => button.dataset.referenceButton ?? button.dataset.choiceKind),
          picture: picture ? [picture.x - root.x, picture.y - root.y, picture.width, picture.height] : null,
        };
      });
    })()`;
    const pictureCount = expected.fields.filter(field => field.artRect).length;
    await until(async () => (await ui.evaluate(inspect)).filter(field => field.picture).length === pictureCount,
      label + ' choice resources rendered');
    const fields = await ui.evaluate(inspect);
    assert.deepEqual(fields, expected.fields.map(field => ({ kinds: field.buttonKinds, picture: field.artRect ?? null })), label);
  },
  async checkFieldValues({ui, document, kind}) {
    if (kind !== 'Catalog') return;
    const asset = path.resolve(path.dirname(document.uri.fsPath), '../../../CommonPictures/ProbeIcon/Ext/Picture/Picture.svg');
    const original = await fs.readFile(asset, 'utf8');
    const changed = original.replace(/#e02020/i, '#1060c0');
    assert.notEqual(changed, original);
    const color = () => ui.evaluate(`(() => {
      const input = document.querySelector('[aria-label="CommonInline"]').closest('.taxi-input');
      const canvas = input.querySelector('.taxi-input-choice-picture');
      return canvas && [...canvas.getContext('2d').getImageData(8, 8, 1, 1).data].join(',');
    })()`);
    assert.equal(await color(), '224,32,32,255');
    try {
      await fs.writeFile(asset, changed);
      await until(async () => await color() === '16,96,192,255', 'choice artwork updates after external file replacement');
    } finally {
      await fs.writeFile(asset, original);
    }
    await until(async () => await color() === '224,32,32,255', 'choice artwork restores from its original file');
  },
});
