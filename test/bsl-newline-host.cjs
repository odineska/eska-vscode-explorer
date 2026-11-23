const assert = require("node:assert/strict");
const { writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const uri = vscode.Uri.file(join(fixture.root, "Newline.bsl"));
  const original = [
    "Процедура Проверка()",
    "\t// абвгд",
    '\tТекст = "один',
    '\t|два три";',
    "\tЧисло = 1;",
    "КонецПроцедуры",
  ].join("\r\n");
  await writeFile(uri.fsPath, original);
  const extension = vscode.extensions.getExtension("1c-tooling.eska-explorer");
  await extension.activate();
  const below = extension.packageJSON.contributes.keybindings.find(binding => binding.key === "ctrl+enter");
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  editor.options = { insertSpaces: false, tabSize: 4 };
  assert.equal(document.languageId, "bsl");
  assert.equal(document.eol, vscode.EndOfLine.CRLF);

  const positions = () => editor.selections.map(({ active, isEmpty }) => [active.line, active.character, isEmpty]);
  editor.selections = [new vscode.Selection(3, 5, 3, 6), new vscode.Selection(1, 6, 1, 6), new vscode.Selection(4, 11, 4, 11)];
  await vscode.commands.executeCommand("type", { text: "\n" });
  assert.equal(document.getText(), original.replace("абвгд", "аб\r\n\t// вгд")
    .replace("два три", "два\r\n\t|три").replace("Число = 1;", "Число = 1;\r\n\t"));
  assert.deepEqual(positions(), [[5, 2, true], [2, 4, true], [7, 1, true]]);
  await vscode.commands.executeCommand("undo");
  assert.equal(document.getText(), original);

  editor.selections = [new vscode.Selection(2, 4, 2, 4), new vscode.Selection(1, 5, 1, 5), new vscode.Selection(2, 7, 2, 7)];
  await vscode.commands.executeCommand(below.command, below.args);
  assert.equal(document.getText(), original.replace("абвгд", "абвгд\r\n\t").replace('"один', '"один\r\n\t'));
  assert.deepEqual(positions(), [[4, 1, true], [2, 1, true]]);
  await vscode.commands.executeCommand("undo");
  assert.equal(document.getText(), original);

  for (const [index, header] of ["Если Истина Тогда", "Процедура Тест()", "Async Procedure Test()"].entries()) {
    const source = `${header} // описание`;
    const headerUri = vscode.Uri.file(join(fixture.root, `Header-${index}.bsl`));
    await writeFile(headerUri.fsPath, source);
    const headerDocument = await vscode.workspace.openTextDocument(headerUri);
    const newline = headerDocument.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const headerEditor = await vscode.window.showTextDocument(headerDocument);
    headerEditor.options = { insertSpaces: true, tabSize: 4 };
    headerEditor.selection = new vscode.Selection(0, source.length, 0, source.length);
    await vscode.commands.executeCommand("type", { text: "\n" });
    assert.equal(headerDocument.getText(), `${source}${newline}    // `, "Enter preserves the block indentation");
    await vscode.commands.executeCommand("undo");
    assert.equal(headerDocument.getText(), source);
    await vscode.commands.executeCommand(below.command, below.args);
    assert.equal(headerDocument.getText(), `${source}${newline}`, "Ctrl+Enter keeps the current indentation without a prefix");
    await vscode.commands.executeCommand("undo");
    assert.equal(headerDocument.getText(), source);
  }

  for (const [index, source] of ["Если Истина Тогда", "    Value = 1;", "\tValue = 1;"].entries()) {
    const ordinaryUri = vscode.Uri.file(join(fixture.root, `Ordinary-${index}.bsl`));
    await writeFile(ordinaryUri.fsPath, source);
    const ordinaryDocument = await vscode.workspace.openTextDocument(ordinaryUri);
    const ordinaryEditor = await vscode.window.showTextDocument(ordinaryDocument);
    ordinaryEditor.options = { insertSpaces: index !== 2, tabSize: 4 };
    ordinaryEditor.selection = new vscode.Selection(0, 5, 0, 5);
    const newline = ordinaryDocument.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    const indentation = source.match(/^[ \t]*/)[0];
    await vscode.commands.executeCommand(below.command, below.args);
    const inserted = source + newline + indentation;
    assert.equal(ordinaryDocument.getText(), inserted);
    await vscode.commands.executeCommand("type", { text: "x" });
    assert.equal(ordinaryDocument.getText(), inserted + "x");
    await vscode.commands.executeCommand("undo");
    assert.equal(ordinaryDocument.getText(), inserted);
    await vscode.commands.executeCommand("undo");
    assert.equal(ordinaryDocument.getText(), source);
  }

  await writeFile(join(fixture.root, "host-result.json"), JSON.stringify({
    passed: true, vscode: vscode.version, crlf: true, multiCursor: true,
    bslLanguageExtension: vscode.extensions.getExtension("1c-syntax.language-1c-bsl")?.packageJSON.version ?? null,
  }));
};
