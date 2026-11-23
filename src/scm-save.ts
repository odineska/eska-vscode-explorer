import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as vscode from "vscode";
import { message } from "./messages.js";
import { dirtyProjectFiles, projectArgs, type ProjectCommandTarget } from "./project-command.js";
import { relativeFile } from "./reveal.js";
import { sourceKey } from "./source.js";
import { findTool } from "./tooling/inspect.js";

export interface ScmSaveScope extends ProjectCommandTarget {
  repositoryRoot: string;
  validate(): void;
  acceptMessage?(message: string): void;
}

export class ScmSaveError extends Error {
  constructor(message: string, readonly diagnostic?: string) {
    super(message);
    this.name = "ScmSaveError";
  }
}

/** A nested checkout can exist even when the built-in Git extension has not opened it. */
async function belongsToRepository(scope: ScmSaveScope): Promise<boolean> {
  const [root, repository] = await Promise.all([realpath(scope.root), realpath(scope.repositoryRoot)]);
  const key = sourceKey(repository);
  if (sourceKey(root) === key) return true;
  if (relativeFile(repository, root) === undefined) return false;
  for (let path = root; sourceKey(path) !== key; path = dirname(path)) {
    try { await lstat(join(path, ".git")); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return true;
}

/** Commit is never killed on timeout or output overflow: hooks can take arbitrarily long. */
function runSave(executable: string, args: string[], cwd: string): Promise<{ code: number | undefined; diagnostic: string }> {
  return new Promise(resolve => {
    try {
      let diagnostic = "";
      const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"], shell: false });
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
        // Always drain the pipe; retaining output must never terminate an active commit.
        diagnostic = (diagnostic + chunk).slice(-16_384);
      });
      child.once("error", () => resolve({ code: undefined, diagnostic }));
      child.once("close", code => resolve({ code: code ?? undefined, diagnostic: diagnostic.trim() }));
    } catch { resolve({ code: undefined, diagnostic: "" }); }
  });
}

/** The caller owns serialization, scope identity and refreshing the SCM view after success. */
export async function saveScmScope(scope: ScmSaveScope, input: string): Promise<boolean> {
  const text = (key: Parameters<typeof message>[1], ...args: string[]) => message(vscode.env.language, key, ...args);
  const preflight = () => {
    scope.validate();
    if (!vscode.workspace.isTrusted) throw new Error(text("untrusted"));
    if (dirtyProjectFiles(scope.root).length) throw new Error(text("scmSaveDirty"));
  };
  preflight();
  let commitMessage = input;
  if (!commitMessage.trim()) {
    const selected = await vscode.window.showInputBox({
      prompt: text("scmSaveMessageRequired"), ignoreFocusOut: true,
      validateInput: value => value.trim() ? undefined : text("scmSaveMessageRequired"),
    });
    if (selected === undefined) return false;
    commitMessage = selected;
    scope.acceptMessage?.(commitMessage);
  }
  if (!commitMessage.trim()) throw new Error(text("scmSaveMessageRequired"));
  const directory = dirname(scope.executable);
  const executable = await findTool("eska", "eska", directory)
    ?? await findTool("eska-vcs", "eska-vcs", directory);
  if (!executable) throw new Error(text("scmSaveMissing"));
  const args = projectArgs(scope.root, "save", ...(scope.workspace ? ["--workspace"] : []), `--message=${commitMessage}`);
  if (!await belongsToRepository(scope).catch(() => false)) throw new Error(text("scmChanged"));
  preflight();
  const { code, diagnostic } = await runSave(executable, args, scope.root);
  if (code !== 0) throw new ScmSaveError(text("scmSaveFailed", code === undefined ? "?" : String(code)), diagnostic);
  return true;
}
