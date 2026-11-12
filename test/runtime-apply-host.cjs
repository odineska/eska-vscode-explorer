const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const vscode = require("vscode");
const { connectWorkbench } = require("./query-constructor-dom.cjs");

exports.run = async function () {
  const { root } = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const native = JSON.parse(process.env.ESKA_HOST_HTTP_FIXTURE);
  const labels = vscode.env.language.startsWith("ru") ? {
    review: "Просмотреть полный импорт",
    apply: "Применить к test",
    cancel: "Отмена",
    conflict: "изменились и сохранённые исходники, и поколение тестовой базы",
  } : {
    review: "Review Full Import",
    apply: "Apply to Test",
    cancel: "Cancel",
    conflict: "Both the saved sources and the test database generation changed",
  };
  const until = async (check, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(label);
  };
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === "eska-explorer");
  await extension.activate();
  await vscode.commands.executeCommand("eska.explorer.restart");
  await vscode.workspace.getConfiguration("window").update("dialogStyle", "custom", vscode.ConfigurationTarget.Global);
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
  await vscode.workspace.getConfiguration("eska.explorer", folder.uri).update("buildExecutable", native.build, vscode.ConfigurationTarget.Workspace);
  const state = path.join(root, ".eska");
  await fs.mkdir(state, { recursive: true });
  await fs.copyFile(native.settings, path.join(state, "settings_local.toml"));
  const source = path.join(root, "src");
  await fs.rm(source, { recursive: true });
  await fs.cp(native.source, source, { recursive: true });

  const workbench = await connectWorkbench(until);
  const click = (label, expectedPath) => until(() => workbench.evaluate(`(() => {
    const box = document.querySelector('.monaco-dialog-box');
    if (!box || !box.textContent.includes(${JSON.stringify(expectedPath)})) return false;
    const button = [...box.querySelectorAll('button, .monaco-button')]
      .find(item => item.textContent.replaceAll('&', '').trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`), label);
  const command = () => vscode.commands.executeCommand("eska.explorer.applyTest");
  const snapshot = async () => {
    const [name] = (await fs.readdir(state)).filter(name => name.startsWith("apply-") && name.endsWith(".json"));
    assert.ok(name);
    return fs.readFile(path.join(state, name), "utf8");
  };
  try {
    const initialize = command();
    await click(labels.review, "");
    await click(labels.apply, "Configuration.xml");
    await initialize;
    const initial = await snapshot();
    const module = path.join(root, "src", "Ext", "ManagedApplicationModule.bsl");
    const contents = await fs.readFile(module, "utf8");
    await fs.writeFile(module, contents.replace("A = 41", "A = 47"));
    const incremental = command();
    await click(labels.apply, "Ext/ManagedApplicationModule.bsl");
    await incremental;
    const applied = await snapshot();
    assert.notEqual(applied, initial);
    const other = await fs.mkdtemp(path.join(state, "external-"));
    await fs.mkdir(path.join(other, ".eska"));
    await fs.copyFile(native.settings, path.join(other, ".eska", "settings_local.toml"));
    await fs.cp(source, path.join(other, "src"), { recursive: true });
    await fs.writeFile(path.join(other, "eska.toml"), "[project]\ntype = 'configuration'\n");
    await fs.writeFile(path.join(other, "src", "Ext", "ManagedApplicationModule.bsl"), contents.replace("A = 41", "A = 49"));
    const apply = (...args) => JSON.parse(execFileSync(native.build,
      ["--lang", "en-US", "apply", "--format", "json", "--initialize", ...args],
      { cwd: other, timeout: 30000, encoding: "utf8" }));
    const external = apply();
    assert.equal(apply("--confirm", external.plan.confirmation).status, "applied");
    await fs.writeFile(module, contents.replace("A = 41", "A = 48"));

    const blocked = command();
    await click(labels.cancel, labels.conflict);
    await blocked;
    assert.equal(await snapshot(), applied);
  } finally {
    workbench.close();
  }
  await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
    passed: true, suite: "runtime-apply", vscode: vscode.version, initialize: true, incremental: true, both_changed: true,
  }));
};
