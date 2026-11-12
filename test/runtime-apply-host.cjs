const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const { connectWorkbench } = require("./query-constructor-dom.cjs");

exports.run = async function () {
  const { root } = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const native = JSON.parse(process.env.ESKA_HOST_HTTP_FIXTURE);
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
    await click("Review Full Import", "");
    await click("Apply to Test", "Configuration.xml");
    await initialize;
    const initial = await snapshot();
    const module = path.join(root, "src", "Ext", "ManagedApplicationModule.bsl");
    const contents = await fs.readFile(module, "utf8");
    await fs.writeFile(module, contents.replace("A = 41", "A = 47"));
    const incremental = command();
    await click("Apply to Test", "Ext/ManagedApplicationModule.bsl");
    await incremental;
    assert.notEqual(await snapshot(), initial);
  } finally {
    workbench.close();
  }
  await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
    passed: true, suite: "runtime-apply", vscode: vscode.version, initialize: true, incremental: true,
  }));
};
