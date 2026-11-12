const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const vscode = require("vscode");

exports.run = async function () {
  const fixture = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const native = JSON.parse(process.env.ESKA_HOST_HTTP_FIXTURE);
  const root = fixture.root;
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === "eska-explorer");
  const explorer = await extension.activate();
  const until = async (check, label) => {
    const deadline = Date.now() + 16000;
    while (Date.now() < deadline) {
      const result = await check();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(label);
  };
  await until(() => explorer.connection.state.kind === "ready", "metadata connected");
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
  const configuration = vscode.workspace.getConfiguration("eska.explorer", folder.uri);
  await configuration.update("debugExecutable", native.binary, vscode.ConfigurationTarget.Workspace);
  const source = path.join(root, "src");
  const module = vscode.Uri.file(path.join(source, "Ext", "ManagedApplicationModule.bsl"));
  if (native.scenario) {
    const result = await runParity(folder, module, native.scenario, until);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, ...result,
    }));
    return;
  }
  const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(module, new vscode.Position(2, 0)));
  vscode.debug.addBreakpoints([breakpoint]);
  const stops = [];
  let session;
  let targets;
  let attached;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return { onError(error) { console.error(error); }, onDidSendMessage(message) {
        if (message.type === "response" && message.success === false) console.error(message.command, message.message);
        if (message.event === "stopped") stops.push(message.body.threadId);
        if (message.command === "eska/listDebugTargets" && message.success) targets = message.body.targets;
        if (message.command === "eska/attachDebugTarget" && message.success) attached = true;
      } };
    },
  });
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA HTTP", type: "eska-debug", request: "launch", profile: "test", projectDir: root,
    }), true);
    const threadId = await until(() => stops[0], "native 1C client reached the breakpoint");
    const stack = await session.customRequest("stackTrace", { threadId });
    assert.equal(stack.stackFrames[0].source.path, module.fsPath);
    assert.equal(stack.stackFrames[0].line, 3);
    const scopes = await session.customRequest("scopes", { frameId: stack.stackFrames[0].id });
    const variables = await session.customRequest("variables", { variablesReference: scopes.scopes[0].variablesReference });
    assert.ok(variables.variables.some(variable => variable.name === "A" && variable.value === "41"));
    const evaluate = (frameId, expression) => session.customRequest("evaluate", { frameId, expression, context: "repl" });
    assert.equal((await evaluate(stack.stackFrames[0].id, "A + 1")).result, "42");
    await session.customRequest("stepIn", { threadId });
    await assert.rejects(evaluate(stack.stackFrames[0].id, "A"));
    await until(() => stops[1], "native 1C client stepped into the callee");
    const nested = await session.customRequest("stackTrace", { threadId: stops[1] });
    assert.equal((await evaluate(nested.stackFrames[1].id, "A + 2")).result, "43");
    await session.customRequest("next", { threadId });
    await until(() => stops[2], "step over");
    await session.customRequest("stepOut", { threadId });
    await until(() => stops[3], "step out");
    vscode.debug.removeBreakpoints([breakpoint]);
    await session.customRequest("setBreakpoints", { source: { path: module.fsPath }, breakpoints: [] });
    await session.customRequest("continue", { threadId });
    const launched = session;
    await vscode.debug.stopDebugging(launched);
    await until(() => vscode.debug.activeDebugSession?.id !== launched.id, "launch disconnected");
    session = undefined;
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA HTTP attach", type: "eska-debug", request: "attach", profile: "test", projectDir: root,
    }), true);
    await until(() => targets?.length, "an existing native debug target is listed");
    await until(async () => {
      await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
      return attached;
    }, "selected debug target attached");
    assert.ok((await session.customRequest("threads")).threads.length);
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints([breakpoint]);
  }
  await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
    passed: true, suite: "debug-http", vscode: vscode.version, breakpoint: true, caller_frame: true, attach: true,
  }));
};

async function runParity(folder, module, scenario, until) {
  const stopEvents = [];
  const output = [];
  let session;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return { onDidSendMessage(message) {
        if (message.event === "stopped") stopEvents.push(message.body);
        if (message.event === "output") output.push(message.body);
      } };
    },
  });
  const location = line => new vscode.Location(module, new vscode.Position(line - 1, 0));
  const breakpoints = scenario === "snapshot" ? [new vscode.SourceBreakpoint(location(5))] : [
    new vscode.SourceBreakpoint(location(3), true, "A < 0"),
    new vscode.SourceBreakpoint(location(5), true, undefined, "2"),
    new vscode.SourceBreakpoint(location(7), true, undefined, undefined, '"ESKA log " + Строка(A)'),
    new vscode.SourceBreakpoint(location(8), true, "A = 5"),
    new vscode.SourceBreakpoint(location(24)),
  ];
  vscode.debug.addBreakpoints(breakpoints);
  const stop = async (reason, line) => {
    const event = await until(() => stopEvents.shift(), `stop at line ${line}`);
    assert.ok(Array.isArray(reason) ? reason.includes(event.reason) : event.reason === reason,
      `expected ${reason}, got ${event.reason}`);
    const stack = await session.customRequest("stackTrace", { threadId: event.threadId });
    assert.equal(stack.stackFrames[0].source.path, module.fsPath);
    assert.equal(stack.stackFrames[0].line, line);
    return { threadId: event.threadId, frameId: stack.stackFrames[0].id };
  };
  const evaluate = (frameId, expression, context) => session.customRequest("evaluate", { frameId, expression, context });
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: `ESKA HTTP ${scenario}`, type: "eska-debug", request: "launch", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    const first = await stop("breakpoint", 5);
    if (scenario === "snapshot") {
      const result = await evaluate(first.frameId, "ПолучитьСнимок()", "repl");
      const expand = async variablesReference => (await session.customRequest("variables", { variablesReference })).variables;
      for (let repeat = 0; repeat < 3; repeat++) {
        const fields = await expand(result.variablesReference);
        const items = await expand(fields.find(field => field.name === "Данные").variablesReference);
        const nested = await expand(items[0].variablesReference);
        assert.equal(nested.find(field => field.name === "Номер").value, "1");
      }
      assert.equal((await evaluate(first.frameId, "Счетчик", "hover")).result, "1");
      await session.customRequest("stepIn", { threadId: first.threadId });
      await assert.rejects(expand(result.variablesReference));
      const nested = await stop(["step", "breakpoint"], 9);
      const stack = await session.customRequest("stackTrace", { threadId: nested.threadId });
      assert.equal((await evaluate(stack.stackFrames[1].id, "A + Счетчик", "hover")).result, "42");
      return { snapshot: true, hover: true, caller_frame: true };
    }
    assert.equal(scenario, "breakpoints");
    assert.equal((await evaluate(first.frameId, "I", "repl")).result, "2");
    const resume = threadId => session.customRequest("continue", { threadId });
    await session.customRequest("setExceptionBreakpoints", {
      filters: [], filterOptions: [{ filterId: "all", condition: "ESKA match" }],
    });
    await resume(first.threadId);
    const condition = await stop("breakpoint", 8);
    assert.ok(output.some(body => body.category === "console" && body.output.includes("ESKA log 4")));
    await resume(condition.threadId);
    const exception = await stop("exception", 15);
    assert.ok(output.some(body => body.category === "stderr" && body.output.includes("ESKA match")));
    await session.customRequest("setExceptionBreakpoints", { filters: [] });
    await resume(exception.threadId);
    await stop("breakpoint", 24);
    return { conditional_breakpoints: true, hit_count: true, logpoint: true, exception_filter: true };
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints(breakpoints);
  }
}
