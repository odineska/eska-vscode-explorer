const assert = require('node:assert/strict');
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
});
