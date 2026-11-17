const assert = require('node:assert/strict');
const vscode = require('vscode');
const { until } = require('./webview-host.cjs');
const { runGallery } = require('./form-input-pixels-host.cjs');

const readState = `(() => {
  const field = id => document.querySelector('[data-element$=":' + id + '"]');
  const visibleGlyphs = root => [...root.querySelectorAll('[data-web-input-glyph]')]
    .filter(tile => getComputedStyle(tile.parentElement).display !== 'none');
  const tiles = visibleGlyphs(document.querySelector('.taxi-preview'));
  return {
    roles: [...new Set(tiles.map(tile => tile.dataset.webInputGlyph))].sort(),
    styles: tiles.map(tile => {
      const style = getComputedStyle(tile);
      return [style.backgroundImage.startsWith('url("data:image/png;base64,'), parseFloat(style.backgroundSize),
        style.imageRendering, parseFloat(style.width) * devicePixelRatio * Number(document.querySelector('.form-zoom select').value) / 100];
    }),
    disabled: visibleGlyphs(field(23)).length,
    readOnly: visibleGlyphs(field(21)).map(tile => tile.dataset.webInputGlyph),
    forcedReadOnly: visibleGlyphs(field(22)).map(tile => tile.dataset.webInputGlyph),
    open: document.querySelector('[data-element$=":11"] [data-web-input-glyph=open]')?.getBoundingClientRect().toJSON(),
    geometry: [...document.querySelectorAll('.taxi-input, .taxi-input-button')].map(node => {
      const box = node.getBoundingClientRect(), form = node.closest('.taxi-form-frame').getBoundingClientRect();
      return [box.x - form.x, box.y - form.y, box.width, box.height];
    }),
  };
})()`;

async function setZoom(ui, zoom) {
  await ui.evaluate(`(() => {
    const zoom = document.querySelector('.form-zoom select');
    zoom.value = ${JSON.stringify(String(zoom))};
    zoom.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await until(() => ui.evaluate(`document.querySelector('.taxi-preview').style.zoom === '${zoom / 100}'`), `preview at ${zoom}%`);
  await ui.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
}

async function checkOpenPixels(ui) {
  const filename = 'reference-buttons-zoom75-' + vscode.env.language;
  const png = await ui.screenshot(filename + '.png', true);
  await ui.evaluate(`document.querySelector('[data-element$=":11"] [data-web-input-glyph=open]').style.visibility = 'hidden'`);
  let blank;
  try {
    await ui.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
    blank = await ui.screenshot(filename + '-without-open.png', true);
  } finally {
    await ui.evaluate(`document.querySelector('[data-element$=":11"] [data-web-input-glyph=open]').style.visibility = ''`);
  }
  const ink = await ui.evaluate(`(async () => {
    async function pixels(png) {
      const image = await createImageBitmap(new Blob([Uint8Array.from(atob(png), value => value.charCodeAt(0))]));
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      image.close();
      return context.getImageData(0, 0, canvas.width, canvas.height);
    }
    const [{data, width}, {data: background}] = await Promise.all([
      pixels(${JSON.stringify(png)}), pixels(${JSON.stringify(blank)}),
    ]);
    const points = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 77 && data[i + 1] === 77 && data[i + 2] === 77 && background[i] === 255
        && background[i + 1] === 255 && background[i + 2] === 255) points.push([i / 4 % width, Math.floor(i / 4 / width)]);
    }
    const bounds = axis => {
      const coordinates = points.map(point => point[axis]);
      return Math.max(...coordinates) - Math.min(...coordinates) + 1;
    };
    return [points.length, bounds(0), bounds(1)];
  })()`);
  assert.deepEqual(ink, [33, 9, 9], '75% open sprite keeps its original physical ink');
}

async function checkPictureOverrides(ui, view, document) {
  const original = document.getText();
  const replace = async text => {
    const revision = view.snapshot.revision, edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    await until(() => view.phase === 'ready' && view.snapshot.revision !== revision && !view.running && !view.timer, 'choice picture revision refreshed');
  };
  const custom = '<ChoiceButtonPicture xmlns:xr="http://v8.1c.ru/8.3/xcf/readable"><xr:Ref>StdPicture.MoveLeft</xr:Ref></ChoiceButtonPicture>';
  const changed = original.replace(/(<InputField name="CasePicker"[^]*?)(<\/InputField>)/, `$1${custom}$2`)
    .replace(/(<InputField name="CasePickerNoDrop"[^]*?)(<\/InputField>)/, '$1<ChoiceButtonPicture xmlns:xr="http://v8.1c.ru/8.3/xcf/readable"><xr:Ref>0</xr:Ref></ChoiceButtonPicture>$2');
  assert.notEqual(changed, original);
  try {
    await replace(changed);
    await until(() => ui.evaluate(`(() => {
      const custom = document.querySelector('[data-element$=":17"] [data-reference-button=choice]');
      const empty = document.querySelector('[data-element$=":18"] [data-reference-button=choice][data-choice-picture-empty]');
      const noAtlasPaint = button => {
        const layer = button?.querySelector('.taxi-web-input-glyphs');
        return !!button && (!layer || getComputedStyle(layer).display === 'none');
      };
      return !!custom?.querySelector('.taxi-input-choice-picture') && noAtlasPaint(custom) && noAtlasPaint(empty);
    })()`), 'custom and explicit empty pictures suppress the choice atlas');
  } finally {
    await replace(original);
  }
}

async function checkFieldValues({ ui, view, document, kind }) {
  if (kind !== 'CatalogButtons') return;
  const before = await ui.evaluate(readState);
  assert.deepEqual(before.roles, []);
  try {
    for (const [zoom, size] of [[50, 14], [75, 14], [125, 20], [150, 24], [200, 32]]) {
      await setZoom(ui, zoom);
      const { roles, styles, disabled, readOnly, forcedReadOnly, open } = await ui.evaluate(readState);
      assert.deepEqual(roles, ['choice', 'dropdown', 'open']);
      assert.equal(disabled, 0);
      assert.deepEqual(readOnly, ['open']);
      assert.deepEqual(forcedReadOnly, ['open']);
      assert.ok(open.width > 0);
      for (const [original, backgroundWidth, rendering, physicalWidth] of styles) {
        assert.equal(original, true);
        assert.equal(rendering, 'pixelated');
        assert.ok(Math.abs(backgroundWidth * zoom / 100 - size * 9) < 0.02);
        assert.ok(Math.abs(physicalWidth - size) < 0.08, JSON.stringify({ zoom, size, physicalWidth }));
      }
      if (zoom === 75) {
        await checkOpenPixels(ui);
        await checkPictureOverrides(ui, view, document);
      }
    }
  } finally {
    await setZoom(ui, 100);
  }
  await until(async () => JSON.stringify((await ui.evaluate(readState)).geometry) === JSON.stringify(before.geometry), '100% field geometry restored');
  assert.deepEqual((await ui.evaluate(readState)).roles, []);
}

exports.run = () => runGallery({
  fixtureKey: 'referenceButtons', prefix: 'reference-buttons',
  dirtyFrom: 'CatalogButtons', dirtyTo: 'Decisions',
  reportKey: 'referenceButtons', dirtyKey: 'dirtyButtons', verifyFrame: true, fullScreen: true,
  checkFieldValues,
});
