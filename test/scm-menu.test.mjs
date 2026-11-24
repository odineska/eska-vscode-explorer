import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const json = async name => JSON.parse(await read(name));
const viewId = "eska.explorer.scm";
const commandId = suffix => `${viewId}.${suffix}`;

function matchesWhen(when, context) {
  return when.split(" && ").every(term => {
    const [key, operator, value] = term.split(" ");
    switch (operator) {
      case "==": return context[key] === (value === "''" ? "" : value);
      case "=~": return new RegExp(value.slice(1, -1)).test(context[key]);
      case undefined: return key.startsWith("!") ? !context[key.slice(1)] : context[key] === true;
      default: assert.fail(`Unexpected when clause: ${term}`);
    }
  });
}

function groupOrder(menuItem) {
  const [group, order = "0"] = menuItem.group.split("@");
  return [group === "navigation" ? "" : group, Number(order)];
}

function visibleCommands(menu, scope) {
  return menu.filter(item => matchesWhen(item.when, scope))
    .sort((a, b) => {
      const [left, leftOrder] = groupOrder(a);
      const [right, rightOrder] = groupOrder(b);
      return left.localeCompare(right) || leftOrder - rightOrder;
    })
    .map(item => item.command);
}

test("1C changes retain their SCM view identity and use native webview menus", async () => {
  const { contributes } = await json("package.json");
  const mode = contributes.configuration.properties["eska.explorer.scm.mode"];
  assert.equal(mode.default, "eska");
  assert.equal(mode.scope, "resource");
  assert.deepEqual(mode.enum, ["eska", "vscode", "both"]);
  const view = contributes.views.scm.find(entry => entry.id === viewId);
  assert.deepEqual(view, {
    id: viewId,
    name: "%scmView%",
    when: "eska.hasProject && !eska.scmNativeOnly",
    visibility: "visible",
    type: "webview",
  });
  const scmItem = entry => entry.command?.startsWith(`${viewId}.`);
  assert.ok(!contributes.menus["view/item/context"].some(scmItem));

  const scmCommands = contributes.commands.filter(scmItem);
  const palette = contributes.menus.commandPalette.filter(scmItem);
  assert.equal(palette.length, scmCommands.length);
  const lineStaging = "isInDiffEditor && eska.scmCanStageLines";
  for (const { command } of scmCommands) {
    const when = command === commandId("stageLines") ? lineStaging
      : [commandId("refresh"), commandId("compareRevisions")].includes(command) ? "eska.hasProject && !eska.scmNativeOnly" : "false";
    assert.deepEqual(palette.filter(item => item.command === command), [{ command, when }]);
  }
  for (const menu of ["editor/title", "editor/context"]) {
    assert.ok(contributes.menus[menu].some(entry => entry.command === commandId("stageLines") && entry.when === lineStaging));
  }
  assert.ok(contributes.menus["view/title"].some(entry =>
    entry.command === commandId("refresh") && entry.when === `view == ${viewId}`,
  ));
});

test("1C file and group context menus follow Git 1.109 command ordering", async () => {
  const { menus } = (await json("package.json")).contributes;
  const menu = menus["webview/context"];
  const scope = {
    webviewId: viewId,
    webviewSection: "scmChange",
    eskaScmKey: "file-key",
    eskaScmDiscard: true,
    eskaScmReveal: true,
    eskaScmCompare: true,
    remoteName: "",
    isLinux: true,
    eskaScmUntrackedMixed: true,
  };
  const expect = (context, actions) => assert.deepEqual(
    visibleCommands(menu, { ...scope, ...context }),
    actions.map(commandId),
    JSON.stringify(context),
  );
  expect({ eskaScmGroup: "merge" }, ["open", "stage", "revealLinux", "revealExplorer"]);
  expect({ eskaScmGroup: "index" }, [
    "diff", "open", "head", "unstage", "revealLinux", "revealExplorer", "compareWorkspace",
  ]);
  expect({ eskaScmGroup: "working" }, [
    "diff", "open", "head", "discard", "stage", "ignore", "revealLinux", "revealExplorer", "compareWorkspace",
  ]);
  expect({ eskaScmGroup: "untracked" }, ["diff", "open", "head", "discard", "stage", "ignore"]);
  expect({ eskaScmGroup: "untracked", eskaScmDiscard: false }, ["diff", "open", "head", "stage", "ignore"]);
  expect({ eskaScmGroup: "working", remoteName: "ssh-remote", eskaScmCompare: false }, [
    "diff", "open", "head", "discard", "stage", "ignore", "revealExplorer",
  ]);
  expect({ eskaScmGroup: "index", eskaScmReveal: false, eskaScmCompare: false }, ["diff", "open", "head", "unstage"]);
  expect({ eskaScmGroup: "merge", isLinux: false, isMac: true }, ["open", "stage", "revealMac", "revealExplorer"]);
  expect({ eskaScmGroup: "merge", isLinux: false, isWindows: true }, ["open", "stage", "revealWindows", "revealExplorer"]);
  for (const [group, actions] of [
    ["merge", ["stageAllMerge"]],
    ["index", ["unstageAll"]],
    ["working", ["discardAll", "stageAll"]],
    ["untracked", ["discardAllUntracked", "stageAllUntracked"]],
  ]) {
    expect({ webviewSection: "scmGroup", eskaScmGroup: group }, actions);
  }
  expect({ webviewSection: "scmGroup", eskaScmGroup: "working", eskaScmUntrackedMixed: false }, [
    "discardAllTracked", "stageAllTracked",
  ]);
  expect({ webviewSection: "scmRepository" }, ["commit", "refresh"]);
  expect({ webviewId: "eska.other", eskaScmGroup: "working" }, []);
  expect({ webviewSection: "", eskaScmGroup: "working" }, []);
});

test("every 1C Changes menu action has English and Russian labels", async () => {
  const [{ contributes }, en, ru, messages] = await Promise.all([
    json("package.json"),
    json("package.nls.json"),
    json("package.nls.ru.json"),
    read("src/messages.ts"),
  ]);
  for (const { command, title } of contributes.commands) {
    if (!command.startsWith(`${viewId}.`)) continue;
    const key = /^%(\w+)%$/.exec(title)?.[1];
    assert.ok(key, command);
    for (const locale of [en, ru]) {
      assert.ok(locale[key], `${command} uses a missing title ${key}`);
      assert.ok(messages.includes(`${key}: ${JSON.stringify(locale[key])}`), `Missing UI label ${locale[key]}`);
    }
  }
  assert.equal(ru.scmStage, "Индексировать изменения");
  assert.equal(ru.scmUnstage, "Отменить индексирование изменений");
  assert.match(messages, /scmIndex: "Индексированные изменения"/);
});

const nativeCommandTitles = {
  scmOpen: "openFile",
  scmDiff: "openChange",
  scmHead: "openHEADFile",
  scmIgnore: "ignore",
  scmStage: "stage",
  scmUnstage: "unstage",
  scmDiscard: "clean",
  scmStageAll: "stageAll",
  scmStageAllTracked: "stageAllTracked",
  scmStageAllUntracked: "stageAllUntracked",
  scmStageAllMerge: "stageAllMerge",
  scmUnstageAll: "unstageAll",
  scmDiscardAll: "cleanAll",
  scmDiscardAllTracked: "cleanAllTracked",
  scmDiscardAllUntracked: "cleanAllUntracked",
  scmOpenAll: "viewChanges",
  scmOpenAllStaged: "viewStagedChanges",
  scmOpenAllUntracked: "viewUntrackedChanges",
  scmRevealLinux: "revealFileInOS.linux",
  scmRevealMac: "revealFileInOS.mac",
  scmRevealWindows: "revealFileInOS.windows",
  scmRevealExplorer: "revealInExplorer",
  scmCompareWorkspace: "compareWithWorkspace",
  scmCommit: "commit",
};

test("English action labels match the built-in Git extension", async t => {
  // Set this to the built-in Git extension directory of VS Code 1.109.
  const gitDir = process.env.ESKA_VSCODE_GIT_DIR;
  if (!gitDir) {
    t.skip("ESKA_VSCODE_GIT_DIR is unset");
    return;
  }
  const git = JSON.parse(await readFile(`${gitDir}/package.nls.json`, "utf8"));
  const en = await json("package.nls.json");
  for (const [eska, native] of Object.entries(nativeCommandTitles)) {
    assert.ok(git[`command.${native}`], native);
    assert.equal(en[eska], git[`command.${native}`], eska);
  }
});

test("Russian action labels match the VS Code language pack where the extension uses the stock wording", async t => {
  const gitTranslations = process.env.ESKA_VSCODE_GIT_RU_TRANSLATIONS;
  if (!gitTranslations) {
    t.skip("ESKA_VSCODE_GIT_RU_TRANSLATIONS is unset");
    return;
  }
  const git = JSON.parse(await readFile(gitTranslations, "utf8")).contents.package;
  const ru = await json("package.nls.ru.json");
  for (const [eska, native] of Object.entries(nativeCommandTitles)) {
    // Use the extension's established term for reverting staged changes.
    if (eska === "scmUnstage") continue;
    assert.ok(git[`command.${native}`], native);
    assert.equal(ru[eska], git[`command.${native}`], eska);
  }
});
