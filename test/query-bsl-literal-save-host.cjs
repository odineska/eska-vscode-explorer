const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { until, closeQueryTabs, returned } = require('./query-modal-host.cjs');

/** Public query editing preserves exact owner bytes across Cyrillic edits, saves and reopenings. */
exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE), accepted = [];
  const title = 'BSL literal saves';
  const prefix = '\ufeff// owner 😀\r\n' + '// Независимый код владельца остаётся без изменений.\r\n'.repeat(1800)
    + 'Процедура Проверка()\r\n\tЗапрос = Новый Запрос;\r\n\tЗапрос.Текст = "';
  const suffix = '";\r\n\tДругоеЗначение = 42;\r\nКонецПроцедуры\r\n';
  const rows = Array.from({ length: 180 }, (_, index) => `    Товары.Наименование КАК Поле${index}`).join(',\n');
  const complex = 'ВЫБРАТЬ\n' + rows + '\nИЗ\n    Справочник.Товары КАК Товары\nГДЕ\n    НЕ Товары.ПометкаУдаления\nУПОРЯДОЧИТЬ ПО\n    Товары.Наименование';
  let current = 'ВЫБРАТЬ 1 КАК А', continuation = '\t\t|', scenario = 'initial';
  const bytes = text => Buffer.from(prefix + text.replaceAll('"', '""').replaceAll('\n', '\r\n' + continuation) + suffix);
  const uri = vscode.Uri.file(fixture.module);
  const open = async () => {
    const owner = await vscode.workspace.openTextDocument(uri, { encoding: 'utf8bom' });
    const editor = await vscode.window.showTextDocument(owner, { preview: false });
    const at = owner.positionAt(owner.getText().indexOf(current.split('\n')[0]) + 3);
    editor.selection = new vscode.Selection(at, at);
    await vscode.commands.executeCommand('eska.explorer.editBslQuery');
    const draft = await until(() => vscode.window.activeTextEditor?.document.uri.scheme === 'eska-query'
      && vscode.window.activeTextEditor.document, 'query opens: ' + scenario);
    assert.ok(draft.getText().replaceAll('\r\n', '\n') === current, 'reopened query text: ' + scenario);
    return draft;
  };
  try {
    await fs.writeFile(fixture.module, bytes(current));
    await vscode.extensions.all.find(value => value.packageJSON.name === 'eska-explorer').activate();
    await vscode.commands.executeCommand('eska.explorer.restart');
    for (const value of [
      { name: 'cyrillic_shared_utf8_prefix', text: 'ВЫБРАТЬ 1 КАК Б' },
      { name: 'insert_crlf_middle', text: 'ВЫБРАТЬ\n    1 КАК Б' },
      { name: 'insert_multiple_middle_lines', text: 'ВЫБРАТЬ\n    1 КАК Б,\n    2 КАК Значение,\n    3 КАК Остаток' },
      { name: 'delete_middle_line', text: 'ВЫБРАТЬ\n    1 КАК Б,\n    3 КАК Остаток' },
      { name: 'large_real_query', text: complex },
      { name: 'large_query_indent_change', text: complex.replaceAll('    ', '\t') },
      { name: 'large_query_middle_cyrillic_change', text: complex.replace('Поле99', 'ПолеЯ9') },
      { name: 'bsl_continuation_indent_change', restyle: true, text: complex.replace('Поле10', 'Измерение10') },
    ]) {
      scenario = value.name;
      if (value.restyle) {
        // This belongs only to the runner's disposable fixture, with its query session already closed.
        continuation = '    |';
        await fs.writeFile(fixture.module, bytes(current));
        const owner = await vscode.workspace.openTextDocument(uri);
        await until(() => owner.getText() === bytes(current).toString('utf8').slice(1), 'owner reloads BSL indentation');
      }
      const draft = await open(), editor = vscode.window.activeTextEditor;
      assert.notEqual((await vscode.workspace.fs.stat(draft.uri)).permissions, vscode.FilePermission.Readonly, 'query opens writable');
      assert.equal(await editor.edit(builder => {
        builder.replace(new vscode.Range(draft.positionAt(0), draft.positionAt(draft.getText().length)), value.text);
        builder.setEndOfLine(vscode.EndOfLine.CRLF);
      }), true, 'native query edit: ' + scenario);
      await until(() => draft.getText().replaceAll('\r\n', '\n') === value.text && draft.isDirty, 'native input acknowledged: ' + scenario);
      assert.equal(await draft.save(), true, 'query Save: ' + scenario);
      await until(async () => !draft.isDirty && (await fs.readFile(fixture.module)).equals(bytes(value.text)), 'exact saved owner bytes: ' + scenario);
      assert.equal(await draft.save(), true, 'repeated Save: ' + scenario);
      assert.ok((await fs.readFile(fixture.module)).equals(bytes(value.text)), 'repeated Save preserves every owner byte');
      assert.ok(draft.getText().replaceAll('\r\n', '\n') === value.text, 'Save preserves query text');
      assert.equal(vscode.window.activeTextEditor?.document, draft, 'Save retains query focus');
      current = value.text;
      await closeQueryTabs(draft);
      const parent = await returned(uri);
      assert.ok(parent.getText() === bytes(current).toString('utf8').slice(1), 'returned owner text');
      assert.equal(parent.isDirty, false, 'owner was persisted');
      accepted.push(scenario);
    }
    const reopened = await open();
    assert.equal(await reopened.save(), true, 'final reopened Save');
    assert.ok((await fs.readFile(fixture.module)).equals(bytes(current)), 'final reopened Save preserves every owner byte');
    await closeQueryTabs(reopened);
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: true, title, accepted }));
  } catch (error) {
    await fs.writeFile(path.join(fixture.root, 'host-result.json'), JSON.stringify({ passed: false, title, scenario, accepted, error: String(error.message ?? error) }));
    throw error;
  }
};
