const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");
const { connectWorkbench } = require("./query-constructor-dom.cjs");

async function until(check, label, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(label);
}

function exited(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error.code === "ESRCH") return true; throw error; }
}

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const { file } = fixture.languageSource;
  const python = process.env.ESKA_TEST_PYTHON;
  assert.ok(path.isAbsolute(python), "Set ESKA_TEST_PYTHON to an absolute path");
  const wrapper = path.join(fixture.root, "controlled-analyzer");
  const mode = path.join(fixture.root, "analyzer-mode");
  const original = await fs.readFile(file, "utf8");
  const diskError = "\nФункция ОшибкаНаДиске(\n";
  const bufferError = "\n\n\nФункция ОшибкаВРедакторе(\n";
  const git = (...args) => execFileSync("git", ["-c", "user.name=ESKA Test", "-c", "user.email=eska@example.invalid",
    "-c", "commit.gpgsign=false", ...args], { cwd: fixture.root, stdio: "pipe" });
  git("init", "-b", "base");
  git("add", "--", path.relative(fixture.root, file));
  git("commit", "-m", "Base");
  git("switch", "-c", "broken");
  await fs.writeFile(file, original + diskError);
  git("add", "--", path.relative(fixture.root, file));
  git("commit", "-m", "Broken BSL");
  git("switch", "base");

  const script = await fs.readFile(path.join(__dirname, "language-restart-analyzer.py"), "utf8");
  await fs.writeFile(wrapper, "#!" + python + "\n" + script, { mode: 0o755 });
  await fs.writeFile(mode, "progress-hang");
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === "eska-explorer");
  const explorer = await extension.activate();
  await until(() => explorer.connection.state.kind === "ready", "metadata connected");
  const metadataSession = explorer.connection.state.session.sessionId;
  const config = vscode.workspace.getConfiguration("eska.explorer");
  await config.update("analyzerExecutable", wrapper, vscode.ConfigurationTarget.Workspace);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(document);
  const diagnostic = code => vscode.languages.getDiagnostics(document.uri).some(item => item.code === code || item.code?.value === code);
  await until(() => explorer.tooling.states.analyzer.phase === "ready" && diagnostic("stale-analyzer"), "controlled analyzer published stale diagnostics");
  const stuck = explorer.language.session.owner.child.pid;
  const client = await connectWorkbench(until);
  const progressVisible = () => client.evaluate("document.querySelector('.statusbar')?.textContent.includes('ESKA controlled Analyze')");
  const command = "eska.explorer.restartLanguage";
  const title = vscode.env.language.startsWith("ru") ? "Перезапустить анализатор BSL и проверить код заново" : "Restart BSL Analyzer and Reanalyze";
  try {
    await until(progressVisible, "unfinished Analyze indicator appears");
    await fs.writeFile(mode, "initialize-hang");
    void vscode.commands.executeCommand("workbench.action.showCommands");
    await until(() => client.evaluate("!!document.querySelector('.quick-input-widget:not([style*=\"display: none\"]) input')"), "command palette opened");
    await client.evaluate(`(() => {const input=document.querySelector('.quick-input-widget input[type=text]'); input.value=${JSON.stringify(">" + title)}; input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const row = await until(() => client.evaluate(`(() => {const row=[...document.querySelectorAll('.quick-input-list .monaco-list-row')].find(item=>item.textContent.includes(${JSON.stringify(title)})); const box=row?.getBoundingClientRect(); return box && box.height ? {x:box.x+box.width/2,y:box.y+box.height/2} : null;})()`), "localized restart is offered in the command palette");
    await client.click(row.x, row.y);
    await until(() => exited(stuck), "hung session reaped");
    await until(async () => !(await progressVisible()) && !diagnostic("stale-analyzer") && !diagnostic("late-analyzer"), "obsolete progress and diagnostics cleared");
    const timeoutPid = await until(async () => Number(await fs.readFile(path.join(fixture.root, "analyzer-pid-initialize-hang"), "utf8").catch(() => "")), "unresponsive replacement started");
    await until(() => explorer.tooling.states.analyzer.phase === "error" && exited(timeoutPid), "initialization timeout reports a recoverable error", 29000);

    await fs.writeFile(mode, "real");
    assert.equal(await editor.edit(edit => edit.insert(document.positionAt(document.getText().length), bufferError)), true);
    const dirty = document.getText();
    await Promise.all(Array.from({ length: 3 }, () => vscode.commands.executeCommand(command)));
    const parseLines = () => vscode.languages.getDiagnostics(document.uri)
      .filter(item => item.code === "ParseError" || item.code?.value === "ParseError").map(item => item.range.start.line);
    await until(() => explorer.tooling.states.analyzer.phase === "ready" && parseLines().length, "real analyzer reads the unsaved buffer", 25000);
    assert.equal(document.isDirty, true);
    assert.equal(document.getText(), dirty);
    assert.equal(await fs.readFile(file, "utf8"), original);
    assert.ok(parseLines().every(line => line >= original.split("\n").length + 1), "diagnostics point to the dirty source");
    const firstDirtyDiagnostic = Math.min(...parseLines());
    assert.equal(diagnostic("late-analyzer"), false);
    const recovered = explorer.language.session.owner.child.pid;
    assert.equal(await editor.edit(edit => edit.replace(new vscode.Range(0, 0, document.lineCount, 0), original)), true);
    assert.equal(await document.save(), true);
    assert.equal(document.isDirty, false);
    git("switch", "broken");
    await until(() => document.getText().includes("ОшибкаНаДиске"), "open editor receives Git branch update");
    await vscode.commands.executeCommand(command);
    await until(() => explorer.tooling.states.analyzer.phase === "ready" && parseLines().some(line => line < firstDirtyDiagnostic),
      "branch diagnostics use the current source", 25000);
    assert.ok(exited(recovered));
    assert.equal(explorer.connection.state.kind, "ready");
    assert.equal(explorer.connection.state.session.sessionId, metadataSession);
    assert.ok((await explorer.getChildren()).some(entry => entry.node));
    assert.equal(vscode.window.activeTextEditor?.document, document);
    const final = explorer.language.session.owner.child.pid;
    await fs.writeFile(path.join(fixture.root, "host-result.json"), JSON.stringify({
      passed: true, suite: "language-restart", vscode: vscode.version, title,
      hung_progress_cleared: true, initialize_timeout: true, dirty_and_branch_diagnostics: true,
      metadata_preserved: true, shutdownPids: [stuck, timeoutPid, recovered, final],
    }));
  } finally {
    client.close();
  }
};
