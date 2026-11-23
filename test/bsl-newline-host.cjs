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

  await writeFile(join(fixture.root, "host-result.json"), JSON.stringify({
    passed: true, vscode: vscode.version, crlf: true, multiCursor: true,
  }));
};
