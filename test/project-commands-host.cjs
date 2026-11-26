const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const { connect, connectWorkbench } = require("./query-constructor-dom.cjs");

async function until(check, label, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const answer = await check();
    if (answer) return answer;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(label);
}

const element = selector => `document.querySelector(${JSON.stringify(selector)})`;
const click = (view, selector) => view.evaluate(`${element(selector)}?.click()`);

async function choose(workbench, title, label, other) {
  const widget = ".quick-input-widget";
  await until(() => workbench.evaluate(`(() => {
    const picker = ${element(widget)};
    return picker?.textContent.includes(${JSON.stringify(title)}) &&
      picker.textContent.includes(${JSON.stringify(label)});
  })()`), `Picker item ${label}`);
  await workbench.evaluate(`${element(widget + " input")}?.focus()`);
  if (other) {
    await workbench.typeText(label);
    await until(() => workbench.evaluate(`(() => {
      const picker = ${element(widget)};
      const rows = picker?.querySelector('.quick-input-list')?.textContent;
      return picker?.querySelector('input')?.value === ${JSON.stringify(label)} &&
        rows?.includes(${JSON.stringify(label)}) && !rows.includes(${JSON.stringify(other)});
    })()`), `filtered picker item ${label}`);
  }
  await workbench.key("Enter", "Enter", 13);
}

async function wizardRoutes(workbench, text) {
  const routes = [
    text("Create a new project", "Создать новый проект"),
    text("Create from CF", "Создать из CF"),
    text("Connect Designer XML", "Подключить исходники Designer XML"),
    text("Clone a Git project", "Клонировать Git-проект"),
  ];
  await until(() => workbench.evaluate(`(() => {
    const labels = document.querySelector('.quick-input-widget')?.textContent;
    return labels && ${JSON.stringify(routes)}.every(route => labels.includes(route));
  })()`), "all four project setup routes");
  await workbench.key("Escape", "Escape", 27);
}

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const russian = vscode.env.language.startsWith("ru");
  const text = (en, ru) => russian ? ru : en;
  if (process.env.ESKA_HOST_PROJECT_COMMANDS_EMPTY === "1") {
    await vscode.commands.executeCommand("eska.explorer.projects.focus");
    const active = await connectWorkbench(until);
    try {
      await active.focus();
      const label = text("Start a 1C project", "Начать проект 1С");
      await until(() => active.evaluate(`(() => {
        const button = [...document.querySelectorAll('.part.sidebar .pane-body a, .part.sidebar .pane-body button')]
          .find(entry => entry.textContent.trim() === ${JSON.stringify(label)});
        if (!button) return false;
        button.click();
        return true;
      })()`), "project onboarding action on the welcome screen").catch(async error => {
        const sidebar = await active.evaluate("document.querySelector('.part.sidebar')?.innerText");
        throw new Error(error.message + " " + sidebar);
      });
      await wizardRoutes(active, text);
      await assert.rejects(fs.access(path.join(fixture.root, "eska.toml")));
    } finally { active.close(); }
    await fs.writeFile(path.join(fixture.root, "host-result.json"), JSON.stringify({
      passed: true, suite: "project-commands", locale: vscode.env.language, welcome: true,
    }));
    return;
  }
  const git = (...args) => execFileSync("git", ["-c", "user.name=ESKA test", "-c", "user.email=eska@example.invalid", ...args], {
    cwd: fixture.root, encoding: "utf8",
  }).trim();
  git("init", "--quiet");
  git("add", "eska.toml", "src", ".gitignore");
  git("commit", "--quiet", "-m", "Before editor commands");
  const modules = (await fs.readdir(fixture.source, { recursive: true })).filter(file => file.endsWith(".bsl"));
  assert.ok(modules.length > 0);
  const module = path.join(fixture.source, modules[0]);

  const extension = vscode.extensions.all.find(item => item.packageJSON.name === "eska-explorer");
  const explorer = await extension.activate();
  await until(() => explorer.connection.state.kind === "ready", "metadata connection");
  const project = await until(() => explorer.tree?.projects[0], "test project is connected");
  const format = { configuration: "cf", extension: "cfe", processing: "epf", report: "erf" }[project.info.type];
  assert.ok(format, project.info.type);
  const gitApi = (await vscode.extensions.getExtension("vscode.git").activate()).getAPI(1);
  assert.ok(await gitApi.openRepository(vscode.Uri.file(fixture.root)));
  const active = await connectWorkbench(until);
  try {
    await vscode.commands.executeCommand("eska.explorer.configureProject");
    const settings = await connect(until, ".settings-page");
    try {
      await click(settings, "[data-settings-section=general]");
      await until(() => settings.evaluate(`!!${element("[data-project-action=doctor]")}`), "doctor available in Project and Build");
      await click(settings, "[data-project-action=doctor]");
      const doctor = await until(() => settings.evaluate(`${element("pre[data-project-action-result=doctor]")}?.textContent`), "native doctor output");
      assert.match(doctor, /Git LFS/i);

      const build = vscode.commands.executeCommand("eska.explorer.buildArtifact");
      const review = await connect(until, "#accept");
      try {
        const preview = await until(() => review.evaluate(`${element("#changes")}?.textContent`), "artifact build plan");
        assert.match(preview, new RegExp(`\\.${format}\\b`));
        assert.match(preview, /Distrobox/);
        const directory = path.join(fixture.root, "build");
        assert.deepEqual(await fs.readdir(directory).catch(() => []), [], "review did not build the file");
        await click(review, "#accept").catch(error => {
          if (error.message !== "debug target closed") throw error;
        });
        await until(async () => (await fs.readdir(directory).catch(() => [])).some(name => name.endsWith("." + format)),
          "artifact built by 1C", 120_000);
        const reveal = text("Open Output Folder", "Открыть папку результата");
        await vscode.commands.executeCommand("notifications.showList");
        const notices = () => active.evaluate("document.querySelector('.notifications-center')?.innerText || ''");
        await until(async () => (await notices()).includes(reveal), "output folder action").catch(async error => {
          throw new Error(error.message + " " + await notices());
        });
      } finally { review.close(); }
      await vscode.commands.executeCommand("notifications.clearAll");
      await vscode.commands.executeCommand("notifications.hideList");
      await build;

      const newMethod = "NewEditorCommandProcedure";
      await fs.appendFile(module, `\nПроцедура ${newMethod}()\nКонецПроцедуры\n`);
      git("add", "src");
      git("commit", "--quiet", "-m", "After editor commands");
      const tree = git("status", "--porcelain", "--untracked-files=no");
      await active.focus();
      const comparison = vscode.commands.executeCommand("eska.explorer.scm.compareRevisions");
      await choose(active, text("Select the earlier version", "Выберите исходную версию"), "Before editor commands", "After editor commands");
      await choose(active, text("Select the later version", "Выберите конечную версию"), "After editor commands");
      await comparison;
      const comparisons = await connect(until, ".semantic-comparison");
      try {
        const found = await comparisons.evaluate("document.querySelector('table').textContent");
        assert.ok(found.includes(newMethod), found);
        assert.equal(git("status", "--porcelain", "--untracked-files=no"), tree);
      } finally { comparisons.close(); }

      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await click(settings, "[data-settings-section=check]");
      await until(() => settings.evaluate(`!!${element("[data-project-action=check]")}`), "full check available in Checks");
      await click(settings, "[data-project-action=check]");
      const summary = await until(() => settings.evaluate(`${element("[data-project-action-result=check]")}?.textContent`),
        "full XML and BSL check", 120_000);
      assert.match(summary, /Check complete|Проверка завершена/);
      const findings = vscode.languages.getDiagnostics(vscode.Uri.file(module));
      assert.ok(findings.some(item => item.source === text("ESKA Project Check", "Проверка проекта ESKA")), summary);
    } finally { settings.close(); }

    const wizard = vscode.commands.executeCommand("eska.explorer.projectOnboarding");
    await wizardRoutes(active, text);
    await wizard;
  } finally { active.close(); }
  await fs.writeFile(path.join(fixture.root, "host-result.json"), JSON.stringify({
    passed: true, suite: "project-commands", locale: vscode.env.language, doctor: true, buildWithReview: true, format,
    realSemanticComparison: true, fullProjectDiagnostics: true, onboardingRoutes: true,
  }));
};
