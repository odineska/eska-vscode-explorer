const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { editFormSource, frame, until } = require('./webview-host.cjs');
const { awaitRevision, platformRow, withPaletteForm } = require('./native-form-palette-host.cjs');

async function sample(ui, label, expected) {
  await ui.evaluate("document.querySelector('.taxi-form-title').click()");
  await ui.evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))');
  await until(() => ui.evaluate("!document.querySelector('[data-native-view-status=pending], [data-native-label=pending]')"),
    'addition paint settled');
  const geometry = await ui.evaluate(`(() => {
    const frame = document.querySelector('.taxi-form-frame');
    const origin = frame.getBoundingClientRect();
    const box = (node, extra = 0) => {
      const r = node.getBoundingClientRect();
      return [Math.round(r.left - origin.left - 1), Math.round(r.top - origin.top - 1),
        Math.round(r.width), Math.round(r.height + extra)];
    };
    const kinds = { SearchStringAddition: 'search', SearchControlAddition: 'manage', ViewStatusAddition: 'status' };
    const regions = Object.fromEntries([...frame.querySelectorAll('[data-standalone-addition]')].map(node => {
      const kind = kinds[node.dataset.kind];
      const target = kind === 'manage' ? node : node.firstElementChild;
      return [kind, { box: box(target), key: node.dataset.element,
        chips: kind === 'status' ? [...target.querySelectorAll('.taxi-view-status-chip')].map(chip => box(chip, 1)) : undefined,
        paint: target.dataset.nativeSearchField ?? target.querySelector('[data-native-button-border]')?.dataset.nativeButtonBorder,
      }];
    }));
    return { frame: [Math.round(origin.width - 2), Math.round(origin.height - 2)], regions,
      ownedCount: [...frame.querySelectorAll('[data-view-status], .taxi-table-search, [data-table-search-control]')]
        .filter(node => !node.closest('[data-standalone-addition]')).length };
  })()`);
  assert.deepEqual(Object.keys(geometry.regions).sort(), Object.keys(expected.regions).sort(), label);
  await ui.parkPointer();
  const png = await ui.screenshot(`standalone-additions-${label}.png`, true);
  const pixels = await ui.evaluate(`(async () => {
    if (devicePixelRatio !== 1) throw new Error('standalone-addition-reference-dpi');
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const geometry = ${JSON.stringify(geometry)};
    const origins = [];
    const blue = (x,y) => {
      const i = (y * canvas.width + x) * 4;
      return data[i] === 30 && data[i+1] === 144 && data[i+2] === 255;
    };
    for (let y=0; y<canvas.height; y++) {
      for (let x=0; x+geometry.frame[0]<=canvas.width; x++) {
        if (!blue(x,y) || x>0&&blue(x-1,y) || y>0&&blue(x,y-1)) continue;
        let right = x;
        while (right < canvas.width && blue(right,y)) right++;
        if (right-x===geometry.frame[0]) origins.push([x,y]);
        x = right-1;
      }
    }
    if (origins.length!==1) throw new Error('standalone-addition-frame '+JSON.stringify({ geometry, origins }));
    const [left,top] = origins[0];
    const digest = async ([dx,dy,w,h]) => {
      const x=left+dx, y=top+dy;
      if (x<0||y<0||x+w>canvas.width||y+h>canvas.height) throw new Error('standalone-addition-crop '+JSON.stringify([x,y,w,h]));
      const rgb = new Uint8Array(w*h*3); let index=0;
      for (let b=0;b<h;b++) for(let a=0;a<w;a++) {
        const p=((y+b)*canvas.width+x+a)*4;
        for(let c=0;c<3;c++) rgb[index++]=data[p+c];
      }
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',rgb));
      return [...hash].map(v=>v.toString(16).padStart(2,'0')).join('');
    };
    const regions = {};
    for (const [kind,region] of Object.entries(geometry.regions)) {
      regions[kind] = {...region, screenshotBox: [left+region.box[0], top+region.box[1], ...region.box.slice(2)], rgbSha256: await digest(region.box)};
      if (region.chips) regions[kind].chips = await Promise.all(region.chips.map(async box => ({box,rgbSha256:await digest(box)})));
    }
    return {origin:origins[0],regions};
  })()`);
  assert.deepEqual(geometry.frame, expected.blueFrameSize, label + '/frame');
  assert.equal(geometry.ownedCount, expected.ownedCount, label + '/owned additions');
  for (const [kind, measured] of Object.entries(pixels.regions)) {
    const native = expected.regions[kind];
    assert.deepEqual(measured.box, native.box, label + '/' + kind);
    if (native.chips) {
      const relative = measured.chips.map(chip => [
        chip.box[0] - measured.box[0], chip.box[1] - measured.box[1], ...chip.box.slice(2),
      ]);
      assert.deepEqual(relative, native.chips.map(chip => chip.box), label + '/chips');
    }
    measured.pixelMatch = measured.rgbSha256 === native.rgbSha256;
    if (native.comparison === 'pixels') assert.equal(measured.pixelMatch, true, label + '/' + kind + '/pixels');
  }
  return { label, frame: geometry.frame, ownedCount: geometry.ownedCount, ...pixels };
}

function widget(view, name) {
  const node = [...view.nodes.values()].find(node => node.name === name);
  assert.ok(node, name);
  const key = node.identity.source + ':current:' + node.identity.key.value;
  return { node, selector: `[data-standalone-addition][data-element=${JSON.stringify(key)}]` };
}

async function dirtyAndDetached(service, { ui, view, main, document, source }) {
  const search = widget(view, 'SearchExtra');
  const query = `document.querySelector(${JSON.stringify(search.selector)})`;
  await ui.evaluate(`(() => { globalThis.__standaloneSearch = ${query}; __standaloneSearch.querySelector('input').click(); })()`);
  await until(() => view.selected?.key.value === search.node.identity.key.value, 'standalone search selected in preview');
  assert.deepEqual(view.selected, search.node.identity);
  await awaitRevision(view);
  const property = platformRow('Source');
  await until(() => ui.evaluate(`!!${property}`), 'standalone source shown in palette');
  await ui.evaluate(`${property}.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',bubbles:true}))`);
  await until(() => {
    const editor = vscode.window.activeTextEditor;
    return editor?.document === document && editor.document.getText(editor.selection).includes('<Item>Rows</Item>');
  }, 'standalone source opens the original XML record');

  const manual = source.replace(/(<SearchStringAddition name="SearchExtra"[^>]*>)/u,
    '$1<Width>9</Width><AutoMaxWidth>false</AutoMaxWidth><MaxWidth>18</MaxWidth>');
  assert.notEqual(manual, source);
  await editFormSource(document, view, manual);
  main.panel.reveal(undefined, false);
  await until(() => ui.evaluate(`${query}?.getBoundingClientRect().width === 190`), 'manual standalone search width');
  assert.deepEqual(view.selected, search.node.identity);
  assert.equal(await ui.evaluate(`globalThis.__standaloneSearch === ${query}`), true);

  await ui.focusWorkbench();
  const workbench = await ui.nativeWindow();
  await service.receive(view, main, { type: 'detach' });
  await until(() => view.frames.get('preview')?.ready, 'standalone preview detached');
  const floating = view.frames.get('preview');
  const detached = await frame({ detached: true, fixedFormArea: true, state: { title: floating.panel.title } });
  try {
    const separate = await detached.nativeWindow({ detached: true });
    assert.notEqual(separate.targetId, workbench.targetId);
    await until(() => detached.evaluate(`${query}?.getBoundingClientRect().width === 190`), 'detached preview receives current search width');

    const hidden = manual.replace(/(<SearchStringAddition name="SearchExtra"[^>]*>)/u, '$1<Visible>false</Visible>');
    assert.notEqual(hidden, manual);
    await editFormSource(document, view, hidden);
    await until(() => detached.evaluate(`${query} === null && !!document.querySelector('.taxi-table-search:not(.taxi-table-search--standalone)')`),
      'dirty XML hides only standalone search in the detached preview');
    assert.deepEqual(view.selected, search.node.identity);
    await editFormSource(document, view, source);
    await until(() => detached.evaluate(`${query}?.getBoundingClientRect().width > 190`), 'detached preview restores automatic width');
    assert.deepEqual(detached.scriptErrors(), []);
  } finally {
    detached.close();
    floating.panel.dispose();
    await until(() => !view.frames.has('preview'), 'standalone preview reattached');
  }
  return [
    { label: 'dirty-search-width-and-xml-navigation', width: 190, sameDom: true },
    { label: 'detached-dirty-visibility-and-restoration', selectedIdentityPreserved: true },
  ];
}

exports.run = async function run() {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), forms = fixture.formGallery;
  const locale = vscode.env.language.startsWith('ru') ? 'ru' : 'en';
  const explorer = await vscode.extensions.all.find(item => item.packageJSON.name === 'eska-explorer').activate();
  await vscode.commands.executeCommand('workbench.action.toggleFullScreen');
  await vscode.commands.executeCommand('eska.explorer.connect');
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
  const results = [], service = explorer.formPreview;
  for (const form of forms) {
    await withPaletteForm(service, form, async context => {
      const { ui } = context;
      await until(() => ui.evaluate("!!document.querySelector('.taxi-preview[data-form-layout=allocated]')"), 'addition form laid out');
      results.push(await sample(ui, form.kind, form.expected[locale]));
      if (form.kind === 'Stack') results.push(...await dirtyAndDetached(service, context));
      if (form.kind === 'NoColumns') {
        const auto = context.source.replace('<Autofill>false</Autofill>', '');
        assert.notEqual(auto, context.source);
        await editFormSource(context.document, context.view, auto);
        results.push(await sample(ui, 'no-columns-with-autofill', form.expected[locale]));
      }
    }, { fixedFormArea: true });
  }
  await explorer.shutdown();
  const result = {passed:true,locale,results};
  await fs.writeFile(path.join(process.env.ESKA_SCREENSHOT_DIR ?? fixture.root, 'observed.json'), JSON.stringify(result,null,2));
  await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify(result));
};
