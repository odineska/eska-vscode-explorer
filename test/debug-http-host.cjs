const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
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
  if (native.scenario === "assign") {
    await runAssignment(folder, module, until);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, set_value: true,
    }));
    return;
  }
  if (native.scenario === "pause") {
    await runPause(folder, module, until);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, pause: true,
    }));
    return;
  }
  if (native.scenario === "restart") {
    await runRestart(folder, module, until);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, restarted: true,
    }));
    return;
  }
  if (native.scenario === "extensions") {
    const files = native.extensions.map(directory =>
      path.join(path.dirname(root), path.basename(directory), "src", "Ext", "ManagedApplicationModule.bsl"));
    await runExtensions(folder, module, files, until);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, configuration_and_extensions: true,
    }));
    return;
  }
  if (native.scenario === "auto-types") {
    await runAutoAttach(folder, module, until);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, auto_attach: true,
    }));
    return;
  }
  if (native.scenario === "paging" || native.scenario === "enumerable") {
    const enumerable = native.scenario === "enumerable";
    await runPaging(folder, module, until, enumerable);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version,
      ...(enumerable ? { enumerable_values: true } : { collection_paging: true }),
    }));
    return;
  }
  if (native.scenario && native.scenario !== "managed") {
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
  let managedPort;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return { onError(error) { console.error(error); }, onDidSendMessage(message) {
        if (message.type === "response" && message.success === false) console.error(message.command, message.message);
        if (message.event === "stopped") stops.push(message.body.threadId);
        if (message.event === "output") {
          const address = message.body.output?.match(/http:\/\/127\.0\.0\.1:(\d+)/);
          if (address) managedPort = Number(address[1]);
        }
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
    if (native.scenario === "managed") {
      assert.ok(managedPort);
      await until(() => new Promise(resolve => {
        const socket = net.connect(managedPort, "127.0.0.1");
        socket.once("connect", () => { socket.destroy(); resolve(false); });
        socket.once("error", () => resolve(true));
      }), "owned dbgs listener closed");
      await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
        passed: true, suite: "debug-http", vscode: vscode.version, managed_dbgs: true,
      }));
      return;
    }
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

async function runAssignment(folder, module, until) {
  const { connectWorkbench } = require("./query-constructor-dom.cjs");
  const workbench = await connectWorkbench(until);
  const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(module, new vscode.Position(6, 0)));
  vscode.debug.addBreakpoints([breakpoint]);
  let session;
  let stopped;
  let assignment;
  let reply;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return {
        onWillReceiveMessage(message) {
          if (message.command === "setVariable") assignment = message.arguments;
        },
        onDidSendMessage(message) {
          if (message.event === "stopped") stopped = message.body.threadId;
          if (message.type === "response" && message.command === "setVariable") reply = message;
        },
      };
    },
  });
  const variableRow = () => workbench.evaluate(`(() => {
    const row = [...document.querySelectorAll('.debug-variables .monaco-list-row')].find(row => row.textContent.startsWith('A ='));
    const rect = row?.getBoundingClientRect();
    return rect ? [rect.x + rect.width / 2, rect.y + rect.height / 2, row.textContent] : null;
  })()`);
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA HTTP Set Value", type: "eska-debug", request: "launch", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    const threadId = await until(() => stopped, "native breakpoint before Set Value");
    await vscode.commands.executeCommand("workbench.debug.action.focusVariablesView");
    const point = await until(async () => {
      const row = await variableRow();
      if (row) return row;
      const expander = await workbench.evaluate(`(() => {
        const twistie = document.querySelector('.debug-variables .monaco-list-row .monaco-tl-twistie.collapsed');
        const rect = twistie?.getBoundingClientRect();
        return rect ? [rect.x + rect.width / 2, rect.y + rect.height / 2] : null;
      })()`);
      if (expander) await workbench.click(...expander);
    }, "local variable A is visible");
    assert.match(point[2], /41$/);
    await workbench.click(point[0], point[1]);
    await vscode.commands.executeCommand("debug.setVariable");
    await until(() => workbench.evaluate(`document.activeElement?.matches('.debug-variables input')`), "Set Value input focused");
    await workbench.evaluate(`document.activeElement.select()`);
    await workbench.submitInput("100 + 23");
    await until(() => reply, "Set Value DAP response");
    assert.equal(assignment.name, "A");
    assert.equal(assignment.value, "100 + 23");
    assert.equal(reply.success, true, JSON.stringify(reply));
    assert.equal(reply.body.value, "123");
    await until(async () => /123$/.test((await variableRow())?.[2] ?? ""), "native Variables view updated");
    const stack = await session.customRequest("stackTrace", { threadId });
    const value = await session.customRequest("evaluate", { frameId: stack.stackFrames[0].id, expression: "A" });
    assert.equal(value.result, "123");
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints([breakpoint]);
    workbench.close();
  }
}

async function runPause(folder, module, until) {
  let session;
  let requested;
  let stopped;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return {
        onWillReceiveMessage(message) {
          if (message.command === "pause") requested = message.arguments.threadId;
        },
        onDidSendMessage(message) {
          if (message.event === "stopped") stopped = message.body;
        },
      };
    },
  });
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA HTTP Pause", type: "eska-debug", request: "launch", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    const threadId = await until(async () => (await session.customRequest("threads")).threads
      .find(thread => thread.name.startsWith("ManagedClient"))?.id, "running native client");
    await until(async () => {
      if (requested === undefined) await vscode.commands.executeCommand("workbench.action.debug.pause", undefined, { sessionId: session.id });
      return requested !== undefined;
    }, "VS Code sent the Pause request");
    const stop = await until(() => stopped, "native client stopped by the VS Code Pause command");
    assert.equal(requested, threadId);
    assert.equal(stop.threadId, threadId);
    assert.equal(stop.reason, "pause");
    const stack = await session.customRequest("stackTrace", { threadId });
    assert.equal(stack.stackFrames[0].line, 6);
    assert.equal(stack.stackFrames[0].source.path, module.fsPath);
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
  }
}

async function runRestart(folder, module, until) {
  const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(module, new vscode.Position(2, 0)));
  vscode.debug.addBreakpoints([breakpoint]);
  const stops = [];
  const ports = [];
  const launches = [];
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(session) {
      return {
        onWillReceiveMessage(message) {
          if (message.command === "launch") launches.push(session);
        },
        onDidSendMessage(message) {
          if (message.event === "stopped") stops.push(message.body.threadId);
          if (message.event === "output") {
            const address = message.body.output?.match(/http:\/\/127\.0\.0\.1:(\d+)/);
            if (address) ports.push(Number(address[1]));
          }
        },
      };
    },
  });
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA HTTP restart", type: "eska-debug", request: "launch", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    await until(() => stops.length === 1 && ports.length === 1 && launches.length === 1, "first managed debug stop");
    await vscode.commands.executeCommand("workbench.action.debug.restart");
    await until(() => stops.length === 2 && ports.length === 2 && launches.length === 2, "managed debug stop after VS Code restart");
    const stack = await launches[1].customRequest("stackTrace", { threadId: stops[1] });
    assert.equal(stack.stackFrames[0].source.path, module.fsPath);
    assert.equal(stack.stackFrames[0].line, 3);
    const value = await launches[1].customRequest("evaluate", { frameId: stack.stackFrames[0].id, expression: "A + 1" });
    assert.equal(value.result, "42");
    await vscode.debug.stopDebugging(launches[1]);
    await until(async () => {
      const closed = await Promise.all(ports.map(port => new Promise(resolve => {
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => { socket.destroy(); resolve(false); });
        socket.once("error", () => resolve(true));
      })));
      return closed.every(Boolean);
    }, "managed dbgs listeners from both sessions closed");
  } finally {
    if (vscode.debug.activeDebugSession?.type === "eska-debug") await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
    tracker.dispose();
    vscode.debug.removeBreakpoints([breakpoint]);
  }
}

async function runExtensions(folder, base, files, until) {
  const breakpoint = (uri, line) => new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(line - 1, 0)));
  const points = [breakpoint(base, 3), ...files.map(file => breakpoint(vscode.Uri.file(file), 4))];
  const stops = [];
  let session;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return { onDidSendMessage(message) { if (message.event === "stopped") stops.push(message.body.threadId); } };
    },
  });
  vscode.debug.addBreakpoints(points);
  const frame = async () => {
    const threadId = await until(() => stops.shift(), "next application breakpoint");
    const stack = await session.customRequest("stackTrace", { threadId });
    return { threadId, top: stack.stackFrames[0] };
  };
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA HTTP application", type: "eska-debug", request: "launch", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    const initial = await frame();
    assert.equal(initial.top.source.path, base.fsPath);
    assert.equal(initial.top.line, 3);
    await session.customRequest("continue", { threadId: initial.threadId });
    const values = new Map(files.map((file, index) => [file, ["111", "222"][index]]));
    for (const _ of files) {
      const { threadId, top } = await frame();
      assert.equal(top.line, 4);
      const expected = values.get(top.source.path);
      assert.ok(expected, top.source.path);
      assert.equal((await session.customRequest("evaluate", { frameId: top.id, expression: "Значение", context: "hover" })).result, expected);
      values.delete(top.source.path);
      await session.customRequest("continue", { threadId });
    }
    assert.equal(values.size, 0);
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints(points);
  }
}

async function runPaging(folder, module, until, enumerable) {
  const { connectWorkbench } = require("./query-constructor-dom.cjs");
  const workbench = await connectWorkbench(until);
  const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(module, new vscode.Position(enumerable ? 5 : 6, 0)));
  vscode.debug.addBreakpoints([breakpoint]);
  const requests = [];
  let session;
  let stopped;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return {
        onDidSendMessage(message) { if (message.event === "stopped") stopped = message.body.threadId; },
        onWillReceiveMessage(message) { if (message.command === "variables") requests.push(message.arguments); },
      };
    },
  });
  const expandRow = async (label, exact = false) => {
    const point = await until(() => workbench.evaluate(`(() => {
      const rows = [...document.querySelectorAll('.debug-variables .monaco-list-row')];
      const row = rows.find(row => ${exact
        ? `row.textContent.startsWith(${JSON.stringify(label + ' =')})`
        : `row.textContent.includes(${JSON.stringify(label)})`});
      const twistie = row?.querySelector('.monaco-tl-twistie.collapsible');
      if (!twistie) return null;
      if (!twistie.classList.contains('collapsed')) return true;
      const rect = twistie.getBoundingClientRect(); return [rect.x + rect.width / 2, rect.y + rect.height / 2];
    })()`), `expand variables row ${label}`).catch(async error => {
      const rows = await workbench.evaluate("[...document.querySelectorAll('.debug-variables .monaco-list-row')].slice(0,8).map(row => [row.textContent, row.querySelector('.monaco-tl-twistie')?.className])");
      throw new Error(`${error.message}: ${JSON.stringify({ rows, requests })}`);
    });
    if (Array.isArray(point)) await workbench.click(...point);
  };
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA HTTP collection paging", type: "eska-debug", request: "launch", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    await until(() => stopped, "client stopped with the large array in scope");
    await vscode.commands.executeCommand("workbench.debug.action.focusVariablesView");
    await expandRow(vscode.env.language.startsWith("ru") ? "Локальные переменные" : "Local variables");
    if (enumerable) {
      await expandRow("ФиксированныйРяд");
      await expandRow('"второй"');
      await expandRow("Значение", true);
      await until(() => workbench.evaluate("[...document.querySelectorAll('.debug-variables .monaco-list-row')].some(row => row.textContent.includes('Вложенный') && row.textContent.includes('22'))"), "nested value in the dictionary");
      return;
    }
    await expandRow("Ряд");
    await expandRow("[500..599]");
    const page = await until(() => requests.find(request => request.filter === "indexed" && request.start === 500), "VS Code requested an indexed page");
    assert.equal(page.count, 100);
    const result = await session.customRequest("variables", page);
    assert.equal(result.variables.length, 100);
    assert.equal(result.variables[50].name, "550");
    const nested = await session.customRequest("variables", { variablesReference: result.variables[50].variablesReference });
    assert.equal(nested.variables[0].value, "550");
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints([breakpoint]);
    workbench.close();
  }
}

async function runAutoAttach(folder, module, until) {
  const { connectWorkbench } = require("./query-constructor-dom.cjs");
  const workbench = await connectWorkbench(until);
  const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(module, new vscode.Position(2, 0)));
  vscode.debug.addBreakpoints([breakpoint]);
  let session;
  let stopped;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return { onDidSendMessage(message) { if (message.event === "stopped") stopped = message.body.threadId; } };
    },
  });
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA HTTP auto-attach", type: "eska-debug", request: "launch", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    await until(() => stopped, "managed client stopped");
    assert.deepEqual((await session.customRequest("eska/getAutoAttachTypes")).selected, ["ManagedClient"]);
    const select = vscode.commands.executeCommand("eska.explorer.selectAutoAttachTypes");
    await until(() => workbench.evaluate("[...document.querySelectorAll('.quick-input-list .monaco-list-row')].some(row => row.textContent.trim() === 'ManagedClient')"), "auto-attach picker opened");
    const toggle = async kind => {
      await workbench.evaluate(`(() => {
        const input = document.querySelector('.quick-input-widget input[type=text]');
        input.focus(); input.value = ${JSON.stringify(kind)}; input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const point = await until(() => workbench.evaluate(`(() => {
        const row = [...document.querySelectorAll('.quick-input-list .monaco-list-row')].find(row => row.textContent.trim() === ${JSON.stringify(kind)});
        const box = row?.querySelector('[role=checkbox], input[type=checkbox]');
        if (!box) return null;
        const rect = box.getBoundingClientRect(); return [rect.x + rect.width / 2, rect.y + rect.height / 2];
      })()`), `checkbox for ${kind}`);
      await workbench.click(...point);
    };
    await toggle("ManagedClient");
    await toggle("ServerEmulation");
    await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
    await select;
    assert.deepEqual((await session.customRequest("eska/getAutoAttachTypes")).selected, ["ServerEmulation"]);
    assert.ok((await session.customRequest("threads")).threads.some(thread => thread.id === stopped));
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints([breakpoint]);
    workbench.close();
  }
}

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
    new vscode.SourceBreakpoint(location(7), true, undefined, undefined, "ESKA log {A}, {{текст}}"),
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
    assert.ok(output.some(body => body.category === "console" && body.output.includes("ESKA log 4, {текст}")));
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
