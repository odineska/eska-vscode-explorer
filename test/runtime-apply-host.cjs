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
    extension: "Расширение",
    fullExtension: "Заменить выбранное расширение в тестовой базе",
    review: "Просмотреть полный импорт",
    apply: "Применить к test",
    cancel: "Отмена",
    companion: "Сопутствующий файл",
    rename: "Переименован Общая форма",
    removed: "Удалён Общая форма",
    conflict: "изменились и сохранённые исходники, и поколение тестовой базы",
  } : {
    extension: "Extension",
    fullExtension: "Replace the selected test extension",
    review: "Review Full Import",
    apply: "Apply to Test",
    cancel: "Cancel",
    companion: "Companion file",
    rename: "Renamed Common form",
    removed: "Removed Common form",
    conflict: "Both the saved sources and the test database generation changed",
  };
  const until = async (check, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const result = await check();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(label);
  };
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === "eska-explorer");
  await extension.activate();
  await vscode.commands.executeCommand("eska.explorer.restart");
  await vscode.workspace.getConfiguration("window").update("dialogStyle", "custom", vscode.ConfigurationTarget.Global);
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
  const config = vscode.workspace.getConfiguration("eska.explorer", folder.uri);
  await config.update("buildExecutable", native.build, vscode.ConfigurationTarget.Workspace);
  await config.update("debugExecutable", native.binary, vscode.ConfigurationTarget.Workspace);
  const state = path.join(root, ".eska");
  await fs.mkdir(state, { recursive: true });
  await fs.copyFile(native.settings, path.join(state, "settings_local.toml"));
  const source = path.join(root, "src");
  await fs.rm(source, { recursive: true });
  await fs.cp(native.source, source, { recursive: true });

  const workbench = await connectWorkbench(until);
  const click = (label, ...expectedText) => until(() => workbench.evaluate(`(() => {
    const box = document.querySelector('.monaco-dialog-box');
    if (!box || !${JSON.stringify(expectedText)}.every(text => box.textContent.includes(text))) return false;
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
    if (native.scenario === "apply-extension-debug") {
      const name = path.basename(native.extensions[0]);
      const member = path.join(path.dirname(root), name);
      const selected = labels.extension + " One (";
      const choose = async () => {
        const point = await until(() => workbench.evaluate(`(() => {
          const row = [...document.querySelectorAll('.quick-input-list .monaco-list-row')]
            .find(item => item.offsetHeight && item.querySelector('.label-name')?.textContent === ${JSON.stringify(name)});
          if (!row) return false;
          const rect = row.getBoundingClientRect();
          return [rect.x + rect.width / 2, rect.y + rect.height / 2];
        })()`), "extension available in project picker");
        await workbench.click(...point);
      };
      const initialize = command();
      await choose();
      await click(labels.review, "");
      await click(labels.apply, labels.fullExtension, selected, "Configuration.xml");
      await initialize;
      const initial = await snapshot();

      const module = path.join(member, "src", "Ext", "ManagedApplicationModule.bsl");
      const original = await fs.readFile(module, "utf8");
      assert.ok(original.includes("Значение = 111"));
      await fs.writeFile(module, original.replace("Значение = 111", "Значение = 333"));
      const incremental = command();
      await choose();
      await click(labels.apply, selected, "Ext/ManagedApplicationModule.bsl");
      await incremental;
      assert.notEqual(await snapshot(), initial);
      await verifyUpdatedDebugSession(folder, module, until, { line: 4, expression: "Значение", expected: "333", projectDir: root });
      await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
        passed: true, suite: "runtime-apply", vscode: vscode.version, locale: vscode.env.language,
        extension_apply: true, debug_after_apply: true, evaluate: "333",
      }));
      return;
    }
    const initialize = command();
    await click(labels.review, "");
    await click(labels.apply, "Configuration.xml");
    await initialize;
    const initial = await snapshot();
    const module = path.join(root, "src", "Ext", "ManagedApplicationModule.bsl");
    const contents = await fs.readFile(module, "utf8");
    await fs.writeFile(module, contents.replace("A = 41", "A = 47"));
    const structural = native.scenario === "apply-structural-debug";
    if (structural) {
      const main = path.join(source, "Configuration.xml");
      const original = await fs.readFile(main, "utf8");
      const entry = "<CommonForm>ProbeButtons</CommonForm>";
      assert.ok(original.includes(entry));
      await fs.writeFile(main, original.replace(entry, "<CommonForm>RenamedProbe</CommonForm>"));
      const directory = path.join(source, "CommonForms");
      const descriptor = await fs.readFile(path.join(directory, "ProbeButtons.xml"), "utf8");
      await fs.writeFile(path.join(directory, "RenamedProbe.xml"), descriptor.replaceAll("ProbeButtons", "RenamedProbe"));
      await fs.unlink(path.join(directory, "ProbeButtons.xml"));
      await fs.rename(path.join(directory, "ProbeButtons"), path.join(directory, "RenamedProbe"));
      const renamed = command();
      await click(labels.apply, labels.rename, "ProbeButtons → RenamedProbe");
      await renamed;
      const afterRename = await snapshot();
      assert.notEqual(afterRename, initial);
      await fs.writeFile(main, original.replace(entry, ""));
      await fs.unlink(path.join(directory, "RenamedProbe.xml"));
      await fs.rm(path.join(directory, "RenamedProbe"), { recursive: true });
      const removed = command();
      await click(labels.apply, labels.removed, "RenamedProbe", labels.companion, "Languages/Русский.xml");
      await removed;
      assert.notEqual(await snapshot(), afterRename);
    } else {
      const catalog = native.scenario === "apply-catalog-debug";
      const descriptorPath = catalog ? "Catalogs/ProbeOwner.xml" : "Languages/Русский.xml";
      const descriptorFile = path.join(source, descriptorPath);
      const descriptor = await fs.readFile(descriptorFile, "utf8");
      const edited = descriptor.replace("<Comment/>", "<Comment>ESKA apply and debug</Comment>");
      assert.notEqual(edited, descriptor);
      await fs.writeFile(descriptorFile, edited);
      const incremental = command();
      const companion = catalog ? [labels.companion, "Catalogs/ProbeOwner/Forms/ProbeObject/Ext/Form.xml"] : [];
      await click(labels.apply, descriptorPath, ...companion);
      await incremental;
    }
    const applied = await snapshot();
    assert.notEqual(applied, initial);
    await verifyUpdatedDebugSession(folder, module, until);
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
    passed: true, suite: "runtime-apply", vscode: vscode.version, initialize: true, incremental: true, both_changed: true, xml_descriptor: true, debug_after_apply: true,
  }));
};


async function verifyUpdatedDebugSession(folder, module, until, { line = 3, expression = "A", expected = "47", projectDir = folder.uri.fsPath } = {}) {
  const uri = vscode.Uri.file(module);
  const point = new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(line - 1, 0)));
  let session;
  let threadId;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return { onDidSendMessage(message) {
        if (message.event === "stopped") threadId = message.body.threadId;
      } };
    },
  });
  vscode.debug.addBreakpoints([point]);
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA debug after apply", type: "eska-debug", request: "launch", profile: "test",
      projectDir,
    }), true);
    await until(() => threadId, "updated configuration reached its breakpoint");
    const { stackFrames: [frame] } = await session.customRequest("stackTrace", { threadId });
    assert.equal(frame.source.path, uri.fsPath);
    const result = await session.customRequest("evaluate", { frameId: frame.id, expression });
    assert.equal(result.result, expected);
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints([point]);
  }
}
