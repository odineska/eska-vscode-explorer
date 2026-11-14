const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const { connect, connectWorkbench } = require("./query-constructor-dom.cjs");

async function until(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(label);
}

const themes = [
  ["Default Dark Modern", "dark"], ["Default Light Modern", "light"],
  ["Default High Contrast", "high-contrast"], ["Default High Contrast Light", "high-contrast-light"],
];
const input = name => `document.querySelector('[name="${name}"]')`;
const fieldValue = (ui, name) => ui.evaluate(input(name) + ".value");
const click = (ui, selector) => ui.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const selectProfile = (ui, name) => click(ui, `button[data-profile="${name}"]`);
const save = ui => click(ui, "button[type=submit]");
const fill = (ui, name, value, select = false) => ui.evaluate(`(() => {
  const control = ${input(name)};
  control.value = ${JSON.stringify(value)};
  control.dispatchEvent(new Event(${JSON.stringify(select ? "change" : "input")}, { bubbles: true }));
})()`);

async function checkLayout(ui, workbench, language) {
  const configuration = vscode.workspace.getConfiguration("workbench");
  const previous = configuration.get("colorTheme");
  const directory = process.env.ESKA_HOST_DOM_ARTIFACTS;
  if (directory) await fs.mkdir(directory, { recursive: true });
  try {
    await vscode.commands.executeCommand("workbench.action.closeSidebar");
    await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
    await vscode.commands.executeCommand("workbench.action.closePanel");
    await workbench.viewport(1440, 960);
    await until(() => ui.evaluate("innerWidth > 650"), "wide settings editor");
    const wide = await ui.evaluate(`(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      return {
        columns: box('#platform').left > box('#database').left && box('#platform').top === box('#database').top,
        labelsAbove: [...document.querySelectorAll('.settings-field')].every(field =>
          field.querySelector('label').getBoundingClientRect().bottom <= field.querySelector('input, select').getBoundingClientRect().top),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    })()`);
    assert.deepEqual(wide, { columns: true, labelsAbove: true, overflow: false });
    const colors = [];
    for (const [theme, kind] of themes) {
      await configuration.update("colorTheme", theme, vscode.ConfigurationTarget.Global);
      await until(() => ui.evaluate(`document.body.classList.contains('vscode-${kind}')`), `settings ${kind} theme`);
      colors.push(await ui.evaluate("getComputedStyle(document.querySelector('input[name=path]')).backgroundColor"));
      assert.equal(await ui.evaluate("getComputedStyle(document.querySelector('.settings-icon')).maskImage.includes('.svg')"), true);
      if (directory) await ui.screenshot(path.join(directory, `runtime-settings-${language}-${kind}.png`));
    }
    assert.notEqual(colors[0], colors[1], "the controls use the active VS Code colors");

    await workbench.viewport(450, 760);
    await until(() => ui.evaluate("innerWidth <= 460"), "narrow settings editor");
    const narrow = await ui.evaluate(`(() => {
      const database = document.querySelector('#database').getBoundingClientRect();
      const platform = document.querySelector('#platform').getBoundingClientRect();
      return platform.top > database.bottom && platform.left === database.left && document.documentElement.scrollWidth <= innerWidth;
    })()`);
    assert.equal(narrow, true);
    if (directory) await ui.screenshot(path.join(directory, `runtime-settings-${language}-narrow.png`));
  } finally {
    await workbench.viewport(1440, 960);
    await configuration.update("colorTheme", previous, vscode.ConfigurationTarget.Global);
  }
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
    return [...roots, ...(await Promise.all(roots.filter(entry => entry.node && !entry.node.parent)
      .map(entry => explorer.getChildren(entry)))).flat()].find(item => item.fileKind === "group" && item.kind === "settings");
  }, "project settings tree node");
  assert.equal(explorer.getTreeItem(settings).contextValue, "eskaProjectSettings");
  const open = async () => {
    await vscode.commands.executeCommand("eska.explorer.configureProject", settings);
    const ui = await connect(until, ".settings-page");
    await until(() => ui.evaluate("!!document.querySelector('.settings-fields')"), "local settings loaded");
    return ui;
  };
  const file = path.join(fixture.root, ".eska", "settings_local.toml");
  const processing = process.env.ESKA_HOST_PROJECT_TYPE === "processing";
  const russian = vscode.env.language.startsWith("ru");
  const text = (en, ru) => russian ? ru : en;
  const picker = process.env.ESKA_HOST_PICKER_BINARY;
  const platform = process.env.ESKA_HOST_PROBE_IBCMD;
  const epfUrl = "file:///Развёртывание/" + "a".repeat(64) + "/Демо.epf";
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(fixture.root));
  if (picker) await vscode.workspace.getConfiguration("eska.explorer", folder.uri)
    .update("debugExecutable", picker, vscode.ConfigurationTarget.Workspace);

  const first = await open();
  const workbench = await connectWorkbench(until);
  const base = path.join(fixture.root, "Демо база");
  await fs.mkdir(base);
  await fs.writeFile(path.join(base, "1Cv8.1CD"), "");
  try {
    assert.equal(await first.evaluate("document.querySelector('h1').textContent"), text("Run and Debug", "Запуск и отладка"));
    assert.equal(await first.evaluate("document.querySelector('.settings-import').matches(':disabled')"), true);
    assert.equal(await first.evaluate("document.querySelector('button[type=submit]').disabled"), true);
    await click(first, "input[name=enabled]");
    await fill(first, "path", "Test draft");
    await selectProfile(first, "prod");
    await click(first, "input[name=enabled]");
    assert.deepEqual(await first.evaluate("[...document.querySelectorAll('select[name=kind] option')].map(option => option.value)"),
      ["file", "cluster", "standalone"]);
    assert.deepEqual(await first.evaluate("[...document.querySelectorAll('select[name=runner] option')].map(option => option.value)"),
      ["local", "distrobox"]);
    await fill(first, "runner", "distrobox", true);
    assert.equal(await first.evaluate("!!document.querySelector('input[name=container]')"), true);
    await fill(first, "runner", "local", true);
    await fill(first, "kind", "standalone", true);
    assert.equal(await first.evaluate("!!document.querySelector('input[name=url]')"), true);
    await fill(first, "kind", "cluster", true);
    assert.equal(await first.evaluate("!!document.querySelector('input[name=host]')"), true);
    await fill(first, "kind", "file", true);

    if (picker) {
      await click(first, ".settings-import");
      await until(async () => {
        const clicked = await workbench.evaluate(`(() => {
          const row = [...document.querySelectorAll(".quick-input-list .monaco-list-row")]
            .find(item => item.textContent.includes("Демо из списка"));
          if (!row) return false;
          row.click();
          return true;
        })()`);
        if (clicked) await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
        return await fieldValue(first, "path") === process.env.ESKA_HOST_PICKER_PATH;
      }, "registered file infobase copied to the draft");
    }
    await fill(first, "path", base);
    if (platform) {
      await fill(first, "ibcmd", platform);
      await fill(first, "version", "8.3.27.2342");
      await click(first, ".settings-check-row button");
      await until(() => first.evaluate("!!document.querySelector('[data-result=success]')"), "draft passed a real build probe");
      await assert.rejects(fs.access(file));
    }

    await fill(first, "endpoint", "tcp://127.0.0.1:1550");
    await save(first);
    assert.equal(await first.evaluate("document.querySelector('input[name=endpoint]').getAttribute('aria-invalid')"), "true");
    assert.equal(await first.evaluate("document.activeElement.name"), "endpoint");
    await assert.rejects(fs.access(file));
    await fill(first, "endpoint", "http://127.0.0.1:1");
    if (platform) {
      assert.equal(await first.evaluate("!!document.querySelector('[data-result=stale]')"), true);
      await click(first, ".settings-check-row button");
      await until(() => first.evaluate("!!document.querySelector('[data-result=failure]')"), "closed TCP port reported by build probe");
      assert.equal(await first.evaluate("document.querySelector('button[type=submit]').disabled"), false);
      await assert.rejects(fs.access(file));
    }

    await workbench.focus();
    await first.evaluate(input("path") + ".focus()");
    await workbench.key("Tab", "Tab", 9);
    assert.equal(await first.evaluate("document.activeElement.name"), "user");
    assert.equal(await first.evaluate("document.activeElement.matches(':focus-visible')"), true);
    await workbench.key("s", "KeyS", 83, process.platform === "darwin" ? 4 : 2);
    await until(() => first.evaluate(`document.querySelector('.settings-save-status').textContent.includes(${JSON.stringify(text("Profile saved.", "Профиль сохранён."))})`), "keyboard save");
    const saved = await fs.readFile(file, "utf8");
    assert.match(saved, /\[prod\.infobase\]/);
    assert.doesNotMatch(saved, /\[test/);
    assert.match(saved, /127\.0\.0\.1:1/);

    await selectProfile(first, "test");
    assert.equal(await fieldValue(first, "path"), "Test draft");
    await click(first, ".settings-actions button[type=button]");
    assert.equal(await first.evaluate("document.querySelector('input[name=enabled]').checked"), false);
    await selectProfile(first, "prod");
    await fill(first, "user", "Demo");
    await fill(first, "secret", "ESKA_DEMO_PASSWORD");
    await first.evaluate(input("customAutoAttach") + ".click()");
    await fill(first, "autoAttach", "ManagedClient, ServerEmulation");
    if (processing) {
      await fill(first, "epfArtifact", "artifacts/Демо.epf");
      await fill(first, "epfDebugUrl", epfUrl);
    } else {
      assert.equal(await first.evaluate(input("epfArtifact") + " === null"), true);
    }

    await fs.writeFile(file, saved + "\n# external edit\n");
    await save(first);
    await until(() => first.evaluate("document.querySelector('.settings-save-status').dataset.status === 'error'"), "external write prevents stale save");
    assert.equal(await fieldValue(first, "secret"), "ESKA_DEMO_PASSWORD");
    await click(first, ".settings-heading button");
    await until(() => first.evaluate("!document.querySelector('button[type=submit]').disabled"), "reloading keeps the draft");
    assert.equal(await fieldValue(first, "secret"), "ESKA_DEMO_PASSWORD");
    await checkLayout(first, workbench, russian ? "ru" : "en");
    await save(first);
    await until(() => first.evaluate(`document.querySelector('.settings-save-status').textContent.includes(${JSON.stringify(text("Profile saved.", "Профиль сохранён."))})`), "profile saved after reload");
  } finally {
    workbench.close();
    first.close();
  }

  const contents = await fs.readFile(file, "utf8");
  assert.match(contents, /password_env = "ESKA_DEMO_PASSWORD"/);
  assert.match(contents, /auto_attach_types = \[\s*"ManagedClient",\s*"ServerEmulation",?\s*\]/);
  assert.doesNotMatch(contents, /\[test/);
  if (processing) assert.ok(contents.includes(epfUrl));

  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  const restored = await open();
  try {
    await selectProfile(restored, "prod");
    assert.equal(await fieldValue(restored, "path"), base);
    assert.equal(await fieldValue(restored, "autoAttach"), "ManagedClient, ServerEmulation");
    if (processing) assert.equal(await fieldValue(restored, "epfDebugUrl"), epfUrl);
    await click(restored, "input[name=managedDebug]");
    await fill(restored, "debugPort", "0");
    await save(restored);
    assert.equal(await restored.evaluate(input("debugPort") + ".getAttribute('aria-invalid')"), "true");
    await fill(restored, "debugPort", "39150");
    await save(restored);
    await until(() => restored.evaluate(`document.querySelector('.settings-save-status').textContent.includes(${JSON.stringify(text("Profile saved.", "Профиль сохранён."))})`), "managed profile saved");
    const managed = await fs.readFile(file, "utf8");
    assert.match(managed, /managed = true/);
    assert.match(managed, /port = 39150/);
    assert.doesNotMatch(managed, /^url =/m);
    await click(restored, "input[name=enabled]");
    assert.equal(await restored.evaluate("document.querySelector('.settings-import').matches(':disabled')"), true);
    await save(restored);
    await until(async () => !(await fs.readFile(file, "utf8")).includes("[prod."), "disabled profile removed from disk");
  } finally { restored.close(); }
  await fs.writeFile(path.join(fixture.root, "host-result.json"), JSON.stringify({
    passed: true, suite: "project-settings", vscode: vscode.version, locale: vscode.env.language,
    independent_drafts: true, keyboard_save: true, disk_conflict: true, draft_probe: !!platform,
    registered_infobase: !!picker, narrow_layout: true, themes: themes.map(([, kind]) => kind), epf: processing,
  }));
};
