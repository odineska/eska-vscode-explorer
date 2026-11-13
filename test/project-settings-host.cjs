const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const { connect, connectWorkbench } = require("./query-constructor-dom.cjs");

async function until(check, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(label);
}

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  execFileSync("git", ["init", "--quiet"], { cwd: fixture.root });
  await fs.writeFile(path.join(fixture.root, ".gitignore"), ".eska/\n");
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === "eska-explorer");
  const explorer = await extension.activate();
  await until(() => explorer.connection.state.kind === "ready", "metadata connected");
  const settings = await until(async () => {
    const roots = await explorer.getChildren();
    for (const item of [...roots, ...(await Promise.all(roots.filter(entry => entry.node && !entry.node.parent)
      .map(entry => explorer.getChildren(entry)))).flat()]) {
      if (item.fileKind === "group" && item.kind === "settings") return item;
    }
  }, "project settings tree node");
  assert.equal(explorer.getTreeItem(settings).contextValue, "eskaProjectSettings");
  const open = async () => {
    await vscode.commands.executeCommand("eska.explorer.configureProject", settings);
    return connect(until, "article h1");
  };
  const file = path.join(fixture.root, ".eska", "settings_local.toml");
  const fill = (panel, name, value) => panel.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(`input[name="${name}"]`)});
    input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  const chooseProd = panel => panel.evaluate("document.querySelectorAll('button[aria-pressed]')[1].click()");
  const save = panel => panel.evaluate("document.querySelector('button.primary').click()");
  const processing = process.env.ESKA_HOST_PROJECT_TYPE === "processing";
  const epfUrl = "file:///Развёртывание/" + "a".repeat(64) + "/Демо.epf";
  const russian = vscode.env.language.startsWith("ru");
  const text = (en, ru) => russian ? ru : en;
  const picker = process.env.ESKA_HOST_PICKER_BINARY;
  if (picker) {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fixture.root));
    await vscode.workspace.getConfiguration("eska.explorer", folder.uri)
      .update("debugExecutable", picker, vscode.ConfigurationTarget.Workspace);
  }
  const first = await open();
  try {
    assert.equal(await first.evaluate("document.querySelector('h1').textContent"),
      text("Project Runtime Settings", "Локальные настройки запуска"));
    await chooseProd(first);
    await first.evaluate("document.querySelector('input[type=checkbox]').click()");
    const layout = await first.evaluate(`(() => {
      const fields = [...document.querySelectorAll(".settings-field > :is(input, select)")];
      return {
        headings: [...document.querySelectorAll(".settings-group h2")].map(title => title.textContent),
        controls: fields.map(field => {
          const { x, width, height } = field.getBoundingClientRect();
          return [x, width, height];
        }),
        contentWidth: document.querySelector(".settings-fields").getBoundingClientRect().width,
        viewportWidth: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    })()`);
    assert.deepEqual(layout.headings, text(
      ["Infobase", "Authentication", "Platform", "Debugging"],
      ["Информационная база", "Аутентификация", "Платформа", "Отладка"],
    ));
    assert.ok(layout.controls.length >= 8);
    const [firstControl] = layout.controls;
    assert.ok(layout.controls.every(control => control.every((value, index) => Math.abs(value - firstControl[index]) < 1)));
    assert.ok(layout.contentWidth >= Math.min(layout.viewportWidth * .85, 1100), "form uses the available editor width");
    assert.equal(layout.overflow, false);
    if (process.env.ESKA_HOST_DOM_ARTIFACTS) {
      await fs.mkdir(process.env.ESKA_HOST_DOM_ARTIFACTS, { recursive: true });
      await first.screenshot(path.join(process.env.ESKA_HOST_DOM_ARTIFACTS, `runtime-settings-${russian ? "ru" : "en"}.png`));
    }
    const viewport = await connectWorkbench(until);
    try {
      await vscode.commands.executeCommand("workbench.action.closeSidebar");
      await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
      await viewport.viewport(510, 730);
      await until(() => first.evaluate("innerWidth <= 560"), "settings receive the narrower editor width");
      const narrow = await first.evaluate(`(() => {
        const field = document.querySelector(".settings-field");
        const label = field.firstElementChild.getBoundingClientRect();
        const control = field.lastElementChild.getBoundingClientRect();
        return { stacked: control.top >= label.bottom && Math.abs(control.left - label.left) < 1,
          viewportWidth: innerWidth, scrollWidth: document.documentElement.scrollWidth };
      })()`);
      assert.ok(narrow.stacked && narrow.scrollWidth <= narrow.viewportWidth, JSON.stringify(narrow));
    } finally {
      await viewport.viewport(1440, 900);
      viewport.close();
    }
    if (picker) {
      const workbench = await connectWorkbench(until);
      try {
        const label = text("Select from 1C Launcher", "Выбрать из списка запуска 1С");
        await first.evaluate(`[...document.querySelectorAll("button")].find(button =>
          button.textContent.trim() === ${JSON.stringify(label)}).click()`);
        await until(async () => {
          const clicked = await workbench.evaluate(`(() => {
            const row = [...document.querySelectorAll(".quick-input-list .monaco-list-row")]
              .find(item => item.textContent.includes("Демо из списка"));
            if (!row) return false;
            row.click();
            return true;
          })()`);
          if (clicked) await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
          return first.evaluate("document.querySelector('input[name=path]').value !== ''");
        }, "registered file infobase copied to the draft");
        assert.equal(await first.evaluate("document.querySelector('input[name=path]').value"), process.env.ESKA_HOST_PICKER_PATH);
        await assert.rejects(fs.access(file));
      } finally { workbench.close(); }
    } else await fill(first, "path", "Демо база");
    await fill(first, "endpoint", "tcp://127.0.0.1:1550");
    await assert.rejects(fs.access(file));
    await save(first);
    await until(() => first.evaluate("document.querySelector('[role=status]').textContent.includes('debug.url')"), "shared backend rejected an invalid endpoint");
    await assert.rejects(fs.access(file));
    await fill(first, "endpoint", "http://127.0.0.1:1550");
    await first.evaluate("document.querySelector('input[name=customAutoAttach]').click()");
    await fill(first, "autoAttach", "ManagedClient, ServerEmulation");
    if (processing) {
      await fill(first, "epfArtifact", "artifacts/Демо.epf");
      await fill(first, "epfDebugUrl", epfUrl);
    } else {
      assert.equal(await first.evaluate("document.querySelector('input[name=epfArtifact]') === null"), true);
    }
    await fill(first, "user", "demo");
    await fill(first, "secret", "ESKA_DEMO_SECRET");
    await save(first);
    await until(() => first.evaluate(`document.querySelector('[role=status]').textContent.includes(${JSON.stringify(text("Local settings saved", "Локальные настройки сохранены"))})`), "profile saved");
    assert.equal(await first.evaluate("document.querySelector('input[type=password]') === null"), true);
  } finally { first.close(); }
  const contents = await fs.readFile(file, "utf8");
  assert.match(contents, /\[prod\.infobase\]/);
  assert.ok(contents.includes(picker ? process.env.ESKA_HOST_PICKER_PATH : "Демо база"));
  assert.match(contents, /password_env = "ESKA_DEMO_SECRET"/);
  assert.match(contents, /auto_attach_types = \[\s*"ManagedClient",\s*"ServerEmulation",?\s*\]/);
  assert.doesNotMatch(contents, /\[test/);
  if (processing) {
    assert.match(contents, /\[prod\.debug\.external_processing\]/);
    assert.ok(contents.includes(epfUrl));
  }
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  const restored = await open();
  try {
    await chooseProd(restored);
    assert.equal(await restored.evaluate("document.querySelector('input[name=path]').value"), picker ? process.env.ESKA_HOST_PICKER_PATH : "Демо база");
    assert.equal(await restored.evaluate("document.querySelector('input[name=autoAttach]').value"), "ManagedClient, ServerEmulation");
    if (processing) {
      assert.equal(await restored.evaluate("document.querySelector('input[name=epfArtifact]').value"), "artifacts/Демо.epf");
      assert.equal(await restored.evaluate("document.querySelector('input[name=epfDebugUrl]').value"), epfUrl);
    }
    await restored.evaluate("document.querySelector('input[name=managedDebug]').click()");
    await fill(restored, "debugPort", "0");
    await save(restored);
    await until(() => restored.evaluate("document.querySelector('[role=status]').textContent.includes('debug.port')"), "invalid local port rejected");
    await fill(restored, "debugPort", "39150");
    await save(restored);
    await until(() => restored.evaluate(`document.querySelector('[role=status]').textContent.includes(${JSON.stringify(text("Local settings saved", "Локальные настройки сохранены"))})`), "managed profile saved");
    const managed = await fs.readFile(file, "utf8");
    assert.match(managed, /managed = true/);
    assert.match(managed, /port = 39150/);
    assert.doesNotMatch(managed, /^url =/m);
  } finally { restored.close(); }
  await fs.writeFile(path.join(fixture.root, "host-result.json"), JSON.stringify({
    passed: true, suite: "project-settings", vscode: vscode.version, prod_only: true,
    shared_validation: true, settings_restored: true, auto_attach_settings: true, epf_settings: processing,
    registered_infobase: !!picker, grouped_aligned_controls: true, narrow_layout: true,
  }));
};
