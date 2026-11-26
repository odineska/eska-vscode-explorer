import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultInspectorUi, parseInspectorState } from '../out/form-preview/inspector-state.js';
import { formStrings } from '../out/form-preview/strings.js';

test('preview theme defaults to VS Code and validates persisted preferences', () => {
  assert.equal(defaultInspectorUi().previewTheme, 'vscode');
  assert.equal(parseInspectorState({ ui: { previewTheme: 'dark' } }).ui.previewTheme, 'dark');
  assert.equal(parseInspectorState({ ui: { previewTheme: 'system' } }).ui.previewTheme, 'vscode');
});

test('preview theme labels exist in both locales', () => {
  for (const locale of ['ru-RU', 'en-US']) {
    const strings = formStrings(locale);
    for (const key of ['previewTheme', 'previewVscode', 'previewLight', 'previewDark']) assert.ok(strings[key]?.length);
  }
});

test('dark preview styles are scoped to 8.5 with an explicit override and VS Code mode', async () => {
  const css = await readFile(new URL('../webview/forms/theme.css', import.meta.url), 'utf8');
  assert.ok(css.includes('[data-profile="version-8.5"][data-preview-theme="dark"]'));
  assert.ok(css.includes('.vscode-dark'));
  assert.ok(css.includes('[data-preview-theme="vscode"]'));
  assert.ok(!css.includes('filter:'));
  assert.doesNotMatch(css, /var\(--vscode-/);
  const entry = await readFile(new URL('../webview/forms/index.jsx', import.meta.url), 'utf8');
  assert.ok(entry.includes("import './theme.css'"));
});

test('Designer XML palette roles have values in both preview themes', async () => {
  const css = await readFile(new URL('../webview/forms/theme.css', import.meta.url), 'utf8');
  for (const name of ['Gray', 'LightBlue', 'Green', 'Yellow', 'Blue', 'Orange', 'Red', 'Purple']) {
    const role = new RegExp('--taxi-Palette' + name + ': (#[0-9a-f]{6});', 'g');
    const values = [...css.matchAll(role)].map(match => match[1]);
    assert.equal(values.length, 2, name);
    assert.notEqual(values[0], values[1], name);
  }
});
