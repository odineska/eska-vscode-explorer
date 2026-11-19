import { dirname } from "node:path";
import * as vscode from "vscode";
import { message } from "./messages.js";
import { relativeFile } from "./reveal.js";
import { findTool } from "./tooling/inspect.js";

export interface ProjectCommandTarget {
  root: string;
  executable: string;
  workspace?: boolean;
}

export function projectArgs(root: string, ...args: string[]): string[] {
  return ["--lang", vscode.env.language.startsWith("ru") ? "ru-RU" : "en-US", "--project-dir", root, ...args];
}

export function projectComponent(target: ProjectCommandTarget, kind: "build" | "check"): Promise<string | undefined> {
  const binary = `eska-${kind}`;
  const configured = kind === "build"
    ? vscode.workspace.getConfiguration("eska.explorer", vscode.Uri.file(target.root)).get("buildExecutable", binary)
    : binary;
  return findTool(configured, binary, dirname(target.executable)).catch(() => undefined);
}

export function projectProgress<T>(title: string, operation: (signal: AbortSignal) => Promise<T>, owner: AbortSignal):
  Thenable<T | undefined> {
  return vscode.window.withProgress({ title, location: vscode.ProgressLocation.Notification, cancellable: true }, async (_, token) => {
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());
    const signal = AbortSignal.any([owner, controller.signal]);
    try {
      if (token.isCancellationRequested || signal.aborted) return;
      const value = await operation(signal);
      if (!signal.aborted) return value;
    } finally {
      cancellation.dispose();
    }
  });
}

export function dirtyProjectFiles(root: string): vscode.TextDocument[] {
  return vscode.workspace.textDocuments.filter(document => document.isDirty
    && (document.uri.scheme === "file" || document.uri.scheme === "vscode-remote")
    && relativeFile(root, document.uri.fsPath) !== undefined);
}

export async function saveProjectFiles(root: string): Promise<boolean> {
  const dirty = dirtyProjectFiles(root);
  if (!dirty.length) return true;
  const save = message(vscode.env.language, "runtimeSaveSources");
  if (await vscode.window.showWarningMessage(message(vscode.env.language, "runtimeUnsavedSources"), { modal: true }, save) !== save) return false;
  for (const document of dirty) if (!await document.save()) return false;
  return !dirtyProjectFiles(root).length;
}
