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
const checkedAutoAttach = ui => ui.evaluate("Array.from(document.querySelectorAll('input[name=autoAttach]:checked'), input => input.value)");
const click = (ui, selector) => ui.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const selectProfile = (ui, name) => click(ui, `button[data-profile="${name}"]`);
const save = ui => click(ui, "button[type=submit]");
const fill = (ui, name, value, select = false) => ui.evaluate(`(() => {
  const control = ${input(name)};
  control.value = ${JSON.stringify(value)};
  control.dispatchEvent(new Event(${JSON.stringify(select ? "change" : "input")}, { bubbles: true }));
})()`);

async function launcherLists(fixture) {
  const binary = process.env.ESKA_TEST_DEBUG_BINARY;
  assert.ok(binary && path.isAbsolute(binary));
  const directory = path.join(path.dirname(fixture.root), "launcher-lists");
  const config = path.join(directory, "config");
  const fileBase = "/srv/1c/Демо база";
  const shared = `[Демо из списка]\nConnect=File="${fileBase}";\n`;
  for (const [name, contents] of [
    ["host", shared],
    ["default-box", shared + '[Демо из Distrobox]\nConnect=Srvr="default.invalid";Ref="Demo";\n'],
    ["profile-box", '[База профиля]\nConnect=Srvr="profile.invalid:1541";Ref="Profile";\n'],
  ]) {
    const startup = path.join(directory, name, ".1C", "1cestart");
    await fs.mkdir(startup, { recursive: true });
    await fs.writeFile(path.join(startup, "ibases.v8i"), contents);
  }
  await fs.mkdir(config);
  await fs.writeFile(path.join(config, "config.toml"), '[build]\nrunner="distrobox"\ncontainer="default-box"\n');
  // Execute the real launcher's container command against a separate fixture home.
  await fs.writeFile(path.join(directory, "distrobox"), `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const end = args.indexOf("--");
if (args[0] !== "enter" || args[1] !== "--name" || !["default-box", "profile-box"].includes(args[2])
    || !args.includes("--no-tty") || end < 0) process.exit(1);
const env = { ...process.env, HOME: require("node:path").join(__dirname, args[2]) };
process.exit(spawnSync(args[end + 1], args.slice(end + 2), { env, stdio: "inherit" }).status ?? 1);
`, { mode: 0o755 });
  const executable = path.join(directory, "eska-debug");
  await fs.writeFile(executable, `#!/usr/bin/env node
const env = { ...process.env, HOME: ${JSON.stringify(path.join(directory, "host"))},
  ESKA_CONFIG_DIR: ${JSON.stringify(config)}, PATH: __dirname + ":" + process.env.PATH };
delete env.ESKA_DISTROBOX;
process.exit(require("node:child_process").spawnSync(${JSON.stringify(binary)}, process.argv.slice(2),
  { env, stdio: "inherit" }).status ?? 1);
`, { mode: 0o755 });
  return { executable, fileBase };
}

const launcherRows = ".quick-input-widget:not([style*='display: none']) .quick-input-list .monaco-list-row";
const rows = workbench => workbench.evaluate(`[...document.querySelectorAll(${JSON.stringify(launcherRows)})].map(row => row.textContent)`);

async function acceptRegisteredBase(workbench, name) {
  await until(() => workbench.evaluate(`(() => {
    const row = [...document.querySelectorAll(${JSON.stringify(launcherRows)})]
      .find(item => item.textContent.includes(${JSON.stringify(name)}));
    if (!row) return false;
    row.click();
    return true;
  })()`), "registered infobase visible");
  await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
}

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

async function checkSharedSettings(open, root, text) {
  const manifest = path.join(root, "eska.toml");
  const original = await fs.readFile(manifest, "utf8");
  const ignore = path.join(root, ".gitignore");
  const originalIgnore = await fs.readFile(ignore, "utf8");
  const attributes = path.join(root, ".gitattributes");
  const originalAttributes = "# manual checkout rule\r\n* text=auto eol=lf\r\n";
  await fs.writeFile(attributes, originalAttributes);
  const section = name => `[data-settings-section="${name}"]`;
  const setting = (name, control) => `${control}[data-setting="${name}"], [data-setting="${name}"] ${control}`;
  const action = name => `[data-settings-action="${name}"]`;
  const element = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const profile = setting("format.profile", "select");
  const align = setting("format.bsl.align_assignments", "input");
  const wrap = setting("format.bsl.wrap_arguments", "select");

  async function setControl(ui, selector, value, event = "input") {
    await ui.evaluate(`(() => {
      const control = ${element(selector)};
      control.value = ${JSON.stringify(value)};
      control.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
    })()`);
  }

  async function preview(ui, fragment) {
    await click(ui, action("preview"));
    const selector = "[data-settings-preview]";
    await until(() => ui.evaluate(`!!${element(selector)} && !!${element(action("save"))} && !${element(action("save"))}.disabled`),
      "shared settings preview ready").catch(async error => {
      const state = await ui.evaluate(`({
        controls: [...document.querySelectorAll(".settings-fields input")].map(input => [input.value, input.validity.valid]),
        alerts: [...document.querySelectorAll("[role=alert]")].map(alert => alert.textContent),
        save: ${element(action("save"))}?.disabled,
        status: document.querySelector(".settings-save-status")?.textContent,
        errors: window.settingsTestErrors,
      })`);
      throw new Error(`${error.message} (${fragment}): ${JSON.stringify(state)}`, { cause: error });
    });
    assert.ok((await ui.evaluate(`${element(selector)}.textContent`)).includes(fragment), fragment);
  }

  async function saveDocument(ui, file, pattern) {
    await click(ui, action("save"));
    await until(async () => pattern.test(await fs.readFile(file, "utf8")), "settings saved to disk");
    await until(() => ui.evaluate(`${element(action("save"))}.disabled && !document.querySelector("fieldset.settings-fields").disabled`),
      "save acknowledged");
    return fs.readFile(file, "utf8");
  }

  async function addGitRule(ui, file, original, pattern) {
    const name = file === ignore ? "ignore" : "attributes";
    await click(ui, `[data-git-file="${name}"]`);
    const selector = `input[aria-label="${text("Add rule", "Добавить правило")}"]`;
    await until(() => ui.evaluate(`!!${element(selector)} && !${element(selector)}.matches(":disabled")`), "Git rule editor ready");
    await setControl(ui, selector, pattern);
    await ui.evaluate(`${element(selector)}.closest(".settings-field").querySelector("button").click()`);
    await preview(ui, pattern);
    assert.equal(await fs.readFile(file, "utf8"), original);
    const expected = name === "ignore" ? pattern : pattern + " filter=lfs diff=lfs merge=lfs -text";
    const eol = name === "ignore" ? "\n" : "\r\n";
    const written = await saveDocument(ui, file, /host-(?:temporary|records)/);
    assert.equal(written, original + expected + eol);
  }

  async function openFormat(ui) {
    await click(ui, section("format"));
    await until(() => ui.evaluate(`!!${element(profile)} && !${element(profile)}.disabled && !!${element(wrap)} && !!${element(align)}`),
      "shared format controls loaded");
  }

  async function checkAnalyzer(ui) {
    await click(ui, section("analyzer"));
    const editor = "[data-analyzer-group=editor]";
    const codeLens = setting("tools.bsl-analyzer.code_lens.show_cyclomatic_complexity", "input");
    await until(() => ui.evaluate(`!!${element(editor)} && !!${element(codeLens)}`), "BSL Analyzer catalog loaded");
    assert.equal(await ui.evaluate(`!${element(codeLens)}.closest("details") && ${element(codeLens)}.getBoundingClientRect().height > 0`), true);
    assert.equal(await ui.evaluate(`${element(codeLens)}.checked`), false);
    await click(ui, codeLens);
    assert.equal(await ui.evaluate(`${element(codeLens)}.checked`), true);
    await preview(ui, "show_cyclomatic_complexity = true");
    const written = await saveDocument(ui, manifest, /show_cyclomatic_complexity\s*=\s*true/);
    assert.match(written, /max_warnings\s*=\s*0/);
    const derived = await fs.readFile(path.join(root, "bsl-analyzer.toml"), "utf8");
    assert.match(derived, /show_cyclomatic_complexity\s*=\s*true/);
  }

  async function assertOverrides(ui) {
    assert.equal(await ui.evaluate(`${element(profile)}.value`), "1c");
    assert.equal(await ui.evaluate(`${element(wrap)}.value`), "one_per_line");
    assert.equal(await ui.evaluate(`${element(align)}.checked`), false);
    assert.equal(await ui.evaluate(`${element(align)}.indeterminate`), false);
  }

  const ui = await open();
  try {
    await ui.evaluate('window.settingsTestErrors = []; window.addEventListener("error", event => window.settingsTestErrors.push(event.error?.stack ?? event.message));');
    await openFormat(ui);
    await setControl(ui, profile, "1c", "change");
    await setControl(ui, wrap, "one_per_line", "change");
    await click(ui, align);
    if (await ui.evaluate(`${element(align)}.checked`)) await click(ui, align);
    await assertOverrides(ui);
    await click(ui, section("general"));
    await until(() => ui.evaluate(`!!${element(setting("project.name", "input"))} && !${element(profile)}`), "general section selected");
    await openFormat(ui);
    await assertOverrides(ui);

    await preview(ui, "one_per_line");
    assert.equal(await fs.readFile(manifest, "utf8"), original);
    const external = original + "\n# manual edit by another editor\n";
    await fs.writeFile(manifest, external);
    await click(ui, action("save"));
    await until(() => ui.evaluate('!!document.querySelector(".settings-error[role=alert]")'), "stale settings save refused");
    assert.equal(await fs.readFile(manifest, "utf8"), external);
    await click(ui, ".settings-heading button");
    await until(() => ui.evaluate(`!${element(action("save"))}.disabled`), "compatible format edits rebased");
    await assertOverrides(ui);
    const saved = await saveDocument(ui, manifest, /one_per_line/);
    assert.match(saved, /profile\s*=\s*"1c"/);
    assert.match(saved, /align_assignments\s*=\s*false/);
    assert.match(saved, /wrap_arguments\s*=\s*"one_per_line"/);
    assert.match(saved, /# manual edit by another editor/);
    assert.equal(await fs.readFile(ignore, "utf8"), originalIgnore);

    await click(ui, section("check"));
    const warnings = setting("tools.eska-check.max_warnings", "input");
    await until(() => ui.evaluate(`!!${element(warnings)}`), "check thresholds loaded");
    await setControl(ui, warnings, "0");
    await preview(ui, "max_warnings = 0");
    assert.equal(await fs.readFile(manifest, "utf8"), saved);
    const checked = await saveDocument(ui, manifest, /max_warnings\s*=\s*0/);
    assert.match(checked, /align_assignments\s*=\s*false/);

    await click(ui, section("git"));
    await addGitRule(ui, ignore, originalIgnore, "/host-temporary/");
    await addGitRule(ui, attributes, originalAttributes, '"host-records/*.mxl"');
    if (process.env.ESKA_TEST_ANALYZER_BINARY) await checkAnalyzer(ui);
  } finally {
    ui.close();
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  }

  const reopened = await open();
  try {
    await openFormat(reopened);
    await assertOverrides(reopened);
  } finally {
    reopened.close();
  }
}

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  execFileSync("git", ["init", "--quiet"], { cwd: fixture.root });
  await fs.writeFile(path.join(fixture.root, ".gitignore"), ".eska/\n");
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === "eska-explorer");
  const explorer = await extension.activate();
  await until(() => explorer.connection.state.kind === "ready", "metadata connected");
  const findSettings = () => until(async () => {
    if (explorer.connection.state.kind !== "ready") return;
    const roots = await explorer.getChildren();
    return [...roots, ...(await Promise.all(roots.filter(entry => entry.node && !entry.node.parent)
      .map(entry => explorer.getChildren(entry)))).flat()].find(item => item.fileKind === "group" && item.kind === "settings");
  }, "project settings tree node");
  const open = async () => {
    const settings = await findSettings();
    assert.equal(explorer.getTreeItem(settings).contextValue, "eskaProjectSettings");
    await vscode.commands.executeCommand("eska.explorer.configureProject", settings);
    const ui = await connect(until, ".settings-page");
    await until(() => ui.evaluate("!!document.querySelector('.settings-fields')"), "local settings loaded");
    return ui;
  };
  const file = path.join(fixture.root, ".eska", "settings_local.toml");
  const processing = process.env.ESKA_HOST_PROJECT_TYPE === "processing";
  const russian = vscode.env.language.startsWith("ru");
  const text = (en, ru) => russian ? ru : en;
  const launcher = process.platform === "linux" && process.env.ESKA_HOST_PICKER_DISTROBOX === "1"
    ? await launcherLists(fixture) : undefined;
  const picker = launcher?.executable ?? process.env.ESKA_HOST_PICKER_BINARY;
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
    assert.equal(await first.evaluate("document.querySelector('h1').textContent"), text("Project Settings", "Настройки проекта"));
    assert.equal(await first.evaluate("document.querySelector('[data-settings-section=run]').textContent.trim()"),
      text("Run and Debug", "Запуск и отладка"));
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
      if (launcher) {
        const visible = await until(async () => {
          const visible = await rows(workbench);
          return visible.length === 2 && visible;
        }, "host and default Distrobox lists combined");
        assert.ok(visible.some(row => row.includes("Демо из списка") && row.includes(launcher.fileBase)
          && row.includes(text("Host", "Хост")) && row.includes("Distrobox (default-box)")));
        assert.ok(visible.some(row => row.includes("Демо из Distrobox") && row.includes("Distrobox (default-box)")
          && row.includes("default.invalid")));
        const directory = process.env.ESKA_HOST_DOM_ARTIFACTS;
        if (directory) {
          await fs.mkdir(directory, { recursive: true });
          await workbench.screenshot(path.join(directory, `registered-infobases-${vscode.env.language}.png`));
        }
      }
      await acceptRegisteredBase(workbench, "Демо из списка");
      await until(() => fieldValue(first, "path").then(value => value === (launcher?.fileBase ?? process.env.ESKA_HOST_PICKER_PATH)),
        "registered file infobase copied to the draft");
      if (launcher) {
        await fill(first, "runner", "distrobox", true);
        await fill(first, "container", "profile-box");
        await click(first, ".settings-import");
        const selected = await until(async () => (await rows(workbench)).find(row => row.includes("База профиля")),
          "unsaved profile container used");
        assert.ok(selected.includes("Distrobox (profile-box)") && selected.includes("profile.invalid:1541"));
        await acceptRegisteredBase(workbench, "База профиля");
        await until(() => first.evaluate(`${input("host")}?.value === "profile.invalid:1541"`), "cluster copied to the draft");
        assert.equal(await fieldValue(first, "name"), "Profile");
        assert.equal(await fieldValue(first, "runner"), "distrobox");
        assert.equal(await fieldValue(first, "container"), "profile-box");
        await assert.rejects(fs.access(file));

        await fill(first, "container", "missing-box");
        await click(first, ".settings-import");
        await until(async () => (await rows(workbench)).some(row => row.includes("Демо из списка")),
          "host list available when Distrobox cannot be read");
        const unavailable = text("Distrobox launcher list unavailable", "Список запуска в Distrobox недоступен");
        await until(() => workbench.evaluate(`document.querySelector('.quick-input-widget input')?.placeholder
          .includes(${JSON.stringify(unavailable + " (missing-box)")})`), "partial lookup message localized");
        await acceptRegisteredBase(workbench, "Демо из списка");
        await until(() => first.evaluate(`${input("path")}?.value === ${JSON.stringify(launcher.fileBase)}`), "host still selectable");
        await fill(first, "runner", "local", true);
      }
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
    assert.equal(await first.evaluate("document.querySelectorAll('input[name=autoAttach]:disabled').length"), 16);
    assert.deepEqual(await checkedAutoAttach(first), ["ManagedClient", "Client", "Server", "ServerEmulation"]);
    assert.equal(await first.evaluate("document.querySelector('input[value=ManagedClient]').closest('label').textContent.trim()"),
      text("Managed client", "Управляемый клиент"));
    await first.evaluate(input("customAutoAttach") + ".click()");
    await click(first, 'input[name=autoAttach][value=Client]');
    await click(first, 'input[name=autoAttach][value=Server]');
    assert.deepEqual(await checkedAutoAttach(first), ["ManagedClient", "ServerEmulation"]);
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
    assert.deepEqual(await checkedAutoAttach(restored), ["ManagedClient", "ServerEmulation"]);
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
  const sharedSettings = process.env.ESKA_HOST_SHARED_SETTINGS === "1";
  if (sharedSettings) await checkSharedSettings(open, fixture.root, text);
  await fs.writeFile(path.join(fixture.root, "host-result.json"), JSON.stringify({
    passed: true, suite: "project-settings", vscode: vscode.version, locale: vscode.env.language,
    shared_settings: sharedSettings, shared_analyzer: sharedSettings && !!process.env.ESKA_TEST_ANALYZER_BINARY,
    independent_drafts: true, keyboard_save: true, disk_conflict: true, draft_probe: !!platform,
    registered_infobase: !!picker, distrobox_infobases: !!launcher, narrow_layout: true,
    themes: themes.map(([, kind]) => kind), epf: processing,
  }));
};
