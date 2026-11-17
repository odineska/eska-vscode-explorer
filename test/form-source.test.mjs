import { win32 } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formEditorRange } from '../out/form-preview/source.js';
import { sourceKey } from '../out/source.js';

test('form source ranges follow native LF/CRLF normalization while retaining BOM and Unicode byte boundaries', () => {
  const prefix = '\ufeff<?xml?>\r\n<!-- 😀 -->\n<Form>\r', selected = '<Title>Привет 😀</Title>', suffix = '\r\n</Form>';
  const bytes = Buffer.from(prefix + selected + suffix), start = Buffer.byteLength(prefix), end = start + Buffer.byteLength(selected);
  for (const eol of ['\n', '\r\n']) {
    const native = bytes.toString('utf8').slice(1).replace(/\r\n|\r|\n/g, eol);
    const range = formEditorRange(bytes, start, end, native, eol);
    assert.equal(native.slice(range.start, range.end), selected);
    assert.throws(() => formEditorRange(bytes, start, end, native.replace('Привет', 'Другое'), eol), {code:'sourceChanged'});
    assert.throws(() => formEditorRange(bytes, start, end, native+' ', eol), {code:'sourceChanged'});
  }
  const unchanged = prefix.slice(1) + selected + suffix;
  const exact = formEditorRange(bytes, start, end, unchanged, '\n');
  assert.equal(unchanged.slice(exact.start, exact.end), selected);
  assert.throws(() => formEditorRange(Buffer.from('x\r\ny'), 2, 4, 'x\ny', '\n'), {code:'sourceChanged'});
});

test('form source identity joins editor and backend Windows spellings without joining different files', () => {
  if (process.platform === 'win32') {
    const source = 'C:/Sources/Формы [проверка]/Form.xml';
    const identity = sourceKey(source);
    assert.equal(sourceKey(source.toLowerCase()), identity);
    assert.equal(sourceKey(win32.normalize(source)), identity);
    assert.equal(sourceKey(win32.toNamespacedPath(source)), identity);
    assert.notEqual(sourceKey(source.replace('C:', 'D:')), identity);
    assert.notEqual(sourceKey(source.replace('Form.xml', 'Module.bsl')), identity);
    const unc = '//server/share/Формы/Form.xml';
    assert.equal(sourceKey(unc), sourceKey(win32.toNamespacedPath(unc)));
  } else {
    assert.notEqual(sourceKey('/sources/Form.xml'), sourceKey('/sources/form.xml'));
  }
});
