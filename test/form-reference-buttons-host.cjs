const assert = require('node:assert/strict');
const vscode = require('vscode');
const { until } = require('./webview-host.cjs');
const { runGallery } = require('./form-input-pixels-host.cjs');

const readState = `(() => {
  const field = id => document.querySelector('[data-element$=":' + id + '"]');
  const visibleGlyphs = root => [...root.querySelectorAll('svg[data-input-glyph]')];
  const glyphs = visibleGlyphs(document.querySelector('.taxi-preview'));
  return {
    roles: [...new Set(glyphs.map(glyph => glyph.dataset.inputGlyph))].sort(),
    drawings: glyphs.map(glyph => {
      const rect = glyph.getBoundingClientRect();
      const slot = glyph.parentElement.getBoundingClientRect(), style = getComputedStyle(glyph);
      return {
        role: glyph.dataset.inputGlyph, width: rect.width, height: rect.height,
        paths: glyph.querySelectorAll('path').length, slotWidth: slot.width, slotHeight: slot.height,
        cssWidth: parseFloat(style.width), cssHeight: parseFloat(style.height),
        field: glyph.closest('[data-element]').dataset.element,
      };
    }),
    states: [21, 22, 23].map(id => visibleGlyphs(field(id)).map(glyph => [
      glyph.dataset.inputGlyph, glyph.parentElement.hasAttribute('data-inactive'), getComputedStyle(glyph).color,
    ])),
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
      return !!custom?.querySelector('.taxi-input-choice-picture') && !!empty
        && !custom.querySelector('[data-input-glyph]') && !empty.querySelector('[data-input-glyph]');
    })()`), 'custom and explicit empty pictures suppress the built-in choice symbol');
  } finally {
    await replace(original);
  }
}

async function checkFieldValues({ ui, view, document, kind }) {
  if (kind !== 'CatalogButtons') return;
  const before = await ui.evaluate(readState);
  const sizes = { choice: [9, 3], dropdown: [7, 5], open: [11, 11] };
  try {
    for (const zoom of [75, 100, 125, 50, 150, 200]) {
      await setZoom(ui, zoom);
      const { roles, drawings, states } = await ui.evaluate(readState);
      assert.deepEqual(roles, ['choice', 'dropdown', 'open']);
      const active = 'rgb(77, 77, 77)', inactive = 'rgb(164, 164, 164)';
      assert.deepEqual(states, [
        [['open', false, active]],
        [['dropdown', true, inactive], ['open', false, active]],
        [['dropdown', true, inactive], ['open', true, inactive]],
      ]);
      for (const drawing of drawings) {
        const { role, width, height, paths, cssWidth, cssHeight, slotWidth, slotHeight } = drawing;
        const info = JSON.stringify({ zoom, ...drawing });
        assert.ok(paths > 0, info);
        // Older Chromium reports the rect in the element's zoom-adjusted CSS coordinates.
        assert.deepEqual([cssWidth, cssHeight], sizes[role], info);
        assert.ok(width > 0 && height > 0 && width <= slotWidth && height <= slotHeight, info);
        assert.ok(Math.abs(width * cssHeight - height * cssWidth) < 0.25, info);
      }
      if (zoom === 75) await checkPictureOverrides(ui, view, document);
    }
  } finally {
    await setZoom(ui, 100);
  }
  await until(async () => JSON.stringify((await ui.evaluate(readState)).geometry) === JSON.stringify(before.geometry), '100% field geometry restored');
  assert.deepEqual((await ui.evaluate(readState)).roles, before.roles);
}

async function prepareCaptureViewport({ ui, label }) {
  if (label !== 'EnumButtons') return;
  // Give the tall enum fixture room by shrinking the inspector above the preview.
  await ui.evaluate(`(() => {
    const splitter = document.querySelector('[role=separator][aria-orientation=horizontal]');
    for (let step = 0; step < 20; step++) {
      splitter?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    }
  })()`);
}

exports.run = () => runGallery({
  fixtureKey: 'referenceButtons', prefix: 'reference-buttons',
  dirtyFrom: 'CatalogButtons', dirtyTo: 'Decisions',
  reportKey: 'referenceButtons', dirtyKey: 'dirtyButtons', verifyFrame: true, verifyReferenceGlyphs: true, fullScreen: true,
  beforeSample: prepareCaptureViewport, checkFieldValues,
});
