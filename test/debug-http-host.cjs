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
  if (explorer) await until(() => explorer.connection.state.kind === "ready", "metadata connected");
  else await vscode.commands.executeCommand("eska.explorer.restart");
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
  const configuration = vscode.workspace.getConfiguration("eska.explorer", folder.uri);
  await configuration.update("debugExecutable", native.binary, vscode.ConfigurationTarget.Workspace);
  const source = path.join(root, "src");
  const module = vscode.Uri.file(path.join(source, "Ext", "ManagedApplicationModule.bsl"));
  if (native.scenario === "epf-server-opaque") {
    const external = vscode.Uri.file(path.join(source, "EskaEpfWire/Ext/ObjectModule.bsl"));
    await runServerOpaqueSnapshot(folder, external, until);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version,
      server_opaque_snapshot: true, nested_properties: true, evaluations: 2,
    }));
    return;
  }
  if (native.scenario === "epf-server" || native.scenario === "epf-server-reload") {
    const external = vscode.Uri.file(path.join(source, "EskaEpfWire/Ext/ObjectModule.bsl"));
    const caller = vscode.Uri.file(path.join(path.dirname(root), "base/src/CommonModules/EskaEpfLoader/Ext/Module.bsl"));
    const value = await runServerProcessing(folder, caller, external, until, native.reload);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, epf_server_attach: true,
      configuration_and_external_frames: true, evaluate: value, epf_reload: !!native.reload,
    }));
    return;
  }
  if (["epf-test", "epf-prod", "epf-attach"].includes(native.scenario)) {
    const form = vscode.Uri.file(path.join(source, "EskaEpfWire/Forms/ProbeForm/Ext/Form/Module.bsl"));
    const production = native.scenario === "epf-prod";
    const attach = native.scenario === "epf-attach";
    const value = await runExternalProcessing(folder, form, until, { production, attach });
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, epf_launch: !attach, epf_attach: attach,
      prod_git_confirmation: production, form_source: true, evaluate: value,
    }));
    return;
  }
  if (native.scenario === "assign") {
    await runAssignment(folder, module, until);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, set_value: true,
    }));
    return;
  }
  if (native.scenario === "multi-logpoint") {
    await runMultiLogpoint(folder, module, until, native);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, multi_logpoint: true,
      continued_other_thread: true, stale_values_rejected: true,
    }));
    return;
  }
  if (native.scenario === "multi-step") {
    await runMultiStep(folder, module, until);
    await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
      passed: true, suite: "debug-http", vscode: vscode.version, multi_step: true,
      continued_threads: 2, stale_frames_rejected: true,
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
  const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(module, new vscode.Position(enumerable ? 5 : 8, 0)));
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
    const threadId = await until(() => stopped, "client stopped with the collection in scope");
    const stack = await session.customRequest("stackTrace", { threadId });
    const frameId = stack.stackFrames[0].id;
    const expression = enumerable ? "ФиксированныйРяд" : "ПолучитьРяд(Ряд)";
    const evaluated = await session.customRequest("evaluate", { frameId, expression });
    assert.equal(evaluated.indexedVariables, enumerable ? 2 : 600);
    const evaluatedPage = await session.customRequest("variables", {
      variablesReference: evaluated.variablesReference, filter: "indexed",
      start: enumerable ? 1 : 550, count: 1,
    });
    assert.equal(evaluatedPage.variables.length, 1);
    if (!enumerable) {
      assert.equal(evaluatedPage.variables[0].name, "550");
      const calls = await session.customRequest("evaluate", { frameId, expression: "Счетчик" });
      assert.equal(calls.result, "1");
    }
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
      const writer = await evaluate(first.frameId, "СоздатьЗаписьJSON()", "repl");
      const reader = await evaluate(first.frameId, "СоздатьЧтениеJSON()", "repl");
      assert.equal(writer.type, "ЗаписьJSON");
      assert.equal(reader.type, "ЧтениеJSON");
      assert.notEqual(writer.variablesReference, reader.variablesReference);
      for (let repeat = 0; repeat < 3; repeat++) {
        const fields = await expand(writer.variablesReference);
        const parameters = fields.find(field => field.name === "Параметры");
        assert.equal(parameters.type, "ПараметрыЗаписиJSON");
        assert.ok((await expand(parameters.variablesReference)).some(field => field.name === "ПереносСтрок"));
        assert.ok((await expand(reader.variablesReference)).some(field => field.name === "ТипТекущегоЗначения"));
      }
      assert.equal((await evaluate(first.frameId, "Счетчик", "hover")).result, "3");
      await session.customRequest("stepIn", { threadId: first.threadId });
      for (const { variablesReference } of [result, writer, reader]) {
        await assert.rejects(expand(variablesReference));
      }
      const nested = await stop(["step", "breakpoint"], 9);
      const stack = await session.customRequest("stackTrace", { threadId: nested.threadId });
      assert.equal((await evaluate(stack.stackFrames[1].id, "A + Счетчик", "hover")).result, "44");
      return { snapshot: true, hover: true, caller_frame: true,
        opaque_evaluation_once: true, opaque_snapshot_available: true };
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

async function runExternalProcessing(folder, module, until, { production, attach }) {
  const line = attach ? 14 : 4;
  const point = new vscode.SourceBreakpoint(new vscode.Location(module, new vscode.Position(line - 1, 0)));
  let session;
  let stopped;
  let failure;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return {
        onError(error) { failure = String(error); },
        onDidSendMessage(message) {
          if (message.event === "stopped") stopped = message.body;
          if (message.type === "response" && message.success === false) failure = message.message;
        },
      };
    },
  });
  vscode.debug.addBreakpoints([point]);
  let workbench;
  try {
    const launch = () => vscode.debug.startDebugging(folder, {
      name: "ESKA EPF", type: "eska-debug", request: attach ? "attach" : "launch",
      profile: production ? "prod" : "test", projectDir: folder.uri.fsPath,
    });
    if (production) {
      await vscode.workspace.getConfiguration("window").update("dialogStyle", "custom", vscode.ConfigurationTarget.Global);
      const { connectWorkbench } = require("./query-constructor-dom.cjs");
      workbench = await connectWorkbench(until);
      const russian = vscode.env.language.startsWith("ru");
      const choose = label => until(() => workbench.evaluate(`(() => {
        const box = document.querySelector(".monaco-dialog-box");
        if (!box?.textContent.includes(${JSON.stringify(russian ? "совпадают с конфигурацией prod" : "deployed production configuration")})) return false;
        const button = [...box.querySelectorAll("button, .monaco-button")]
          .find(item => item.textContent.replaceAll("&", "").trim() === ${JSON.stringify(label)});
        if (!button) return false;
        button.click();
        return true;
      })()`), label);
      const cancelled = launch();
      await choose(russian ? "Отмена" : "Cancel");
      assert.equal(await cancelled, false);
      assert.equal(session, undefined);
      const approved = launch();
      await choose(russian ? "Запустить с текущими исходниками" : "Use Current Sources");
      assert.equal(await approved, true);
    } else {
      assert.equal(await launch(), true);
    }
    const event = await until(() => {
      assert.equal(failure, undefined);
      return stopped;
    }, "external processing breakpoint");
    assert.equal(event.reason, "breakpoint");
    const stack = await session.customRequest("stackTrace", { threadId: event.threadId });
    const top = stack.stackFrames[0];
    assert.equal(top.line, line);
    assert.equal(top.source.path, module.fsPath);
    const value = await session.customRequest("evaluate", { frameId: top.id, expression: "Значение" });
    if (attach) assert.ok(Number(value.result) >= 2, value.result);
    else assert.equal(value.result, "73");
    return value.result;
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    workbench?.close();
    tracker.dispose();
    vscode.debug.removeBreakpoints([point]);
  }
}

async function runServerProcessing(folder, caller, external, until, reload) {
  const point = new vscode.SourceBreakpoint(new vscode.Location(caller, new vscode.Position(2, 0)));
  const externalPoint = new vscode.SourceBreakpoint(new vscode.Location(external, new vscode.Position(2, 0)));
  const stops = [];
  let session;
  let failure;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return { onDidSendMessage(message) {
        if (message.event === "stopped") stops.push(message.body);
        if (message.type === "response" && message.success === false) failure = message.message;
      } };
    },
  });
  const stopped = () => until(() => {
    assert.equal(failure, undefined);
    return stops.shift();
  }, "server EPF stopped");
  const frames = async threadId => (await session.customRequest("stackTrace", { threadId })).stackFrames;
  const step = async (command, threadId) => {
    await session.customRequest(command, { threadId });
    const event = await stopped();
    assert.equal(event.threadId, threadId);
    return frames(threadId);
  };
  vscode.debug.addBreakpoints([point]);
  try {
    const attach = async () => assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA server EPF", type: "eska-debug", request: "attach", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    const evaluate = async frame => (await session.customRequest("evaluate", { frameId: frame.id, expression: "Результат" })).result;
    await attach();
    const { threadId, reason } = await stopped();
    assert.equal(reason, "breakpoint");
    assert.equal((await frames(threadId))[0].source.path, caller.fsPath);
    const entered = await step("stepIn", threadId);
    assert.equal(entered[0].source.path, external.fsPath);
    assert.equal(entered[1].source.path, caller.fsPath);
    const [inside] = await step("next", threadId);
    assert.equal(inside.source.path, external.fsPath);
    assert.equal(await evaluate(inside), "42");
    vscode.debug.removeBreakpoints([point]);
    await session.customRequest("setBreakpoints", { source: { path: caller.fsPath }, breakpoints: [] });
    let [returned] = await step("stepOut", threadId);
    assert.equal(returned.source.path, caller.fsPath);
    if (returned.line === 3) [returned] = await step("next", threadId);
    assert.equal(returned.line, 4);
    assert.equal(await evaluate(returned), "42");
    if (!reload) return "42";

    vscode.debug.addBreakpoints([point]);
    await session.customRequest("setBreakpoints", { source: { path: caller.fsPath }, breakpoints: [{ line: 3 }] });
    await fs.writeFile(reload.marker, "");
    await session.customRequest("continue", { threadId });
    const reloaded = await stopped();
    const [unknown, callerFrame] = await step("stepIn", reloaded.threadId);
    assert.equal(unknown.source, undefined);
    assert.equal(callerFrame.source.path, caller.fsPath);
    const [replaced] = await step("next", reloaded.threadId);
    assert.equal(await evaluate(replaced), "84");
    vscode.debug.removeBreakpoints([point]);
    await session.customRequest("continue", { threadId: reloaded.threadId });
    await vscode.debug.stopDebugging(session);
    await until(() => !vscode.debug.activeDebugSession, "old EPF debug session detached");

    await fs.copyFile(reload.module, external.fsPath);
    await fs.copyFile(reload.settings, path.join(folder.uri.fsPath, ".eska", "settings_local.toml"));
    vscode.debug.addBreakpoints([externalPoint]);
    await attach();
    const rebound = await stopped();
    const [current] = await frames(rebound.threadId);
    assert.equal(current.source.path, external.fsPath);
    assert.equal(current.line, 3);
    assert.equal(await evaluate(current), "84");
    return "84";
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints([point, externalPoint]);
  }
}

async function runMultiStep(folder, module, until) {
  const point = new vscode.SourceBreakpoint(new vscode.Location(module, new vscode.Position(5, 0)));
  let session;
  let next;
  const stops = [];
  const resumed = [];
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return {
        onWillReceiveMessage(message) {
          if (message.command === "next") next = message.arguments;
        },
        onDidSendMessage(message) {
          if (message.event === "stopped") stops.push(message.body);
          if (message.event === "continued") resumed.push(message.body);
        },
      };
    },
  });
  vscode.debug.addBreakpoints([point]);
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA HTTP multi-step", type: "eska-debug", request: "launch", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    const clients = await until(async () => {
      const { targets } = await session.customRequest("eska/listDebugTargets");
      for (const target of targets.filter(item => item.kind === "ManagedClient")) {
        await session.customRequest("eska/attachDebugTarget", { id: target.id });
      }
      const { threads } = await session.customRequest("threads");
      const attached = threads.filter(thread => thread.name.startsWith("ManagedClient")).map(thread => thread.id);
      return attached.length === 2 ? attached : undefined;
    }, "two attached native clients");
    await until(() => stops.length === 2, "both native clients stopped on the breakpoint");
    assert.deepEqual(new Set(stops.map(event => event.threadId)), new Set(clients));
    assert.ok(stops.every(event => event.reason === "breakpoint"), JSON.stringify(stops));
    const previous = await Promise.all(clients.map(async threadId => {
      const { stackFrames } = await session.customRequest("stackTrace", { threadId });
      assert.equal(stackFrames[0].source.path, module.fsPath);
      assert.equal(stackFrames[0].line, 6);
      return stackFrames[0].id;
    }));
    vscode.debug.removeBreakpoints([point]);
    await session.customRequest("setBreakpoints", { source: { path: module.fsPath }, breakpoints: [] });
    await until(async () => {
      if (!next) await vscode.commands.executeCommand("workbench.action.debug.stepOver");
      return next;
    }, "VS Code sent Step Over for a stopped client");
    assert.ok(clients.includes(next.threadId));
    const stop = await until(() => stops[2], "selected client stopped after the step");
    assert.equal(stop.reason, "step");
    assert.equal(stop.threadId, next.threadId);
    assert.deepEqual(resumed.map(event => event.threadId).sort((a, b) => a - b), [...clients].sort((a, b) => a - b));
    assert.ok(resumed.every(event => event.allThreadsContinued === false));
    const { stackFrames } = await session.customRequest("stackTrace", { threadId: stop.threadId });
    assert.equal(stackFrames[0].line, 7);
    const other = clients.find(id => id !== stop.threadId);
    await assert.rejects(session.customRequest("stackTrace", { threadId: other }));
    for (const frameId of previous) await assert.rejects(session.customRequest("scopes", { frameId }));
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints([point]);
  }
}

async function runMultiLogpoint(folder, module, until, native) {
  const location = line => new vscode.Location(module, new vscode.Position(line - 1, 0));
  const points = [
    new vscode.SourceBreakpoint(location(16)),
    new vscode.SourceBreakpoint(location(11), true, undefined, undefined, "ESKA multi-target {Значение}"),
  ];
  const events = [];
  let session;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return { onDidSendMessage(message) { if (message.type === "event") events.push(message); } };
    },
  });
  vscode.debug.addBreakpoints(points);
  const frame = async threadId => (await session.customRequest("stackTrace", { threadId })).stackFrames[0];
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA HTTP multi-logpoint", type: "eska-debug", request: "attach", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    const configured = await session.customRequest("setBreakpoints", {
      source: { path: module.fsPath },
      breakpoints: [{ line: 16 }, { line: 11, logMessage: "ESKA multi-target {Значение}" }],
    });
    assert.ok(configured.breakpoints.every(point => point.verified));
    const { targets } = await session.customRequest("eska/listDebugTargets");
    const external = targets.find(target => target.kind === "ManagedClient");
    if (external) await session.customRequest("eska/attachDebugTarget", { id: external.id });
    const stop = await until(() => events.find(event => event.event === "stopped"), "external client stopped");
    const { threadId } = stop.body;
    const oldFrame = await frame(threadId);
    assert.equal(oldFrame.line, 16);
    const result = await session.customRequest("evaluate", {
      frameId: oldFrame.id, expression: 'Новый Структура("Поле", Значение)',
    });
    const child = await session.customRequest("variables", { variablesReference: result.variablesReference });
    assert.equal(child.variables[0].value, "41");
    await fs.writeFile(path.resolve(native.source, "../..", "start-log-client"), "");
    const output = await until(() => events.find(event => event.event === "output" &&
      event.body.output.includes("ESKA multi-target 22")), "second client logged the value").catch(error => {
      throw new Error(`${error.message}: ${JSON.stringify(events.filter(event => ["output", "thread", "stopped"].includes(event.event)))}`);
    });
    const resumed = await until(() => events.find(event => event.event === "continued" &&
      event.body.threadId === threadId), "external client resumed");
    assert.ok(resumed.seq > output.seq);
    assert.equal(resumed.body.allThreadsContinued, false);
    await assert.rejects(session.customRequest("scopes", { frameId: oldFrame.id }));
    await assert.rejects(session.customRequest("variables", { variablesReference: result.variablesReference }));
    await until(() => events.find(event => event.event === "stopped" &&
      event.body.threadId === threadId && event.seq > resumed.seq), "external client stopped again");
    assert.notEqual((await frame(threadId)).id, oldFrame.id);
    assert.equal(events.filter(event => event.event === "continued" && event.body.threadId === threadId).length, 1);
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints(points);
  }
}

async function runServerOpaqueSnapshot(folder, module, until) {
  const point = new vscode.SourceBreakpoint(new vscode.Location(module, new vscode.Position(4, 0)));
  let session;
  let stop;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return { onDidSendMessage(message) {
        if (message.event === "stopped") stop = message.body;
      } };
    },
  });
  vscode.debug.addBreakpoints([point]);
  try {
    assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA server Evaluate", type: "eska-debug", request: "attach", profile: "test", projectDir: folder.uri.fsPath,
    }), true);
    const { threadId } = await until(() => stop, "server frame stopped");
    const { stackFrames: [frame] } = await session.customRequest("stackTrace", { threadId });
    assert.equal(frame.source.path, module.fsPath);
    assert.equal(frame.line, 5);
    const evaluate = expression => session.customRequest("evaluate", { frameId: frame.id, expression, context: "watch" });
    const expand = async variablesReference => (await session.customRequest("variables", { variablesReference })).variables;
    const writer = await evaluate("СоздатьЗаписьJSON()");
    assert.equal(writer.type, "ЗаписьJSON");
    for (let attempt = 0; attempt < 3; attempt++) {
      const fields = await expand(writer.variablesReference);
      const parameters = fields.find(field => field.name === "Параметры");
      assert.equal(parameters.type, "ПараметрыЗаписиJSON");
      assert.ok((await expand(parameters.variablesReference)).some(field => field.name === "ПереносСтрок"));
    }
    const reader = await evaluate("СоздатьЧтениеJSON()");
    assert.equal(reader.type, "ЧтениеJSON");
    assert.ok((await expand(reader.variablesReference)).some(field => field.name === "ТипТекущегоЗначения"));
    assert.equal((await evaluate("Счетчик")).result, "2");
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints([point]);
  }
}
