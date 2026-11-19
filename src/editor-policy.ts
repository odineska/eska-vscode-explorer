import * as vscode from "vscode";
import { readonlyPattern } from "./support-settings.js";

/** Native include/exclude rules use the IDE's glob matcher; no command changes its session override. */
export function configuredReadOnly(document: vscode.TextDocument, ignoredWorkspaceRule?: string): boolean {
  return configuredReadOnlyResource(document.uri, document.languageId, ignoredWorkspaceRule);
}

/** Native glob matching needs only the resource and language identity, including not-yet-created files. */
export function configuredReadOnlyResource(uri: vscode.Uri, languageId = "", ignoredWorkspaceRule?: string): boolean {
  const document = { uri, languageId } as vscode.TextDocument;
  const configuration = vscode.workspace.getConfiguration("files", document.uri);
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const matches = (rules: Record<string, boolean>): boolean => Object.entries(rules).some(([pattern, value]) => value === true
    && (vscode.languages.match({ scheme: uri.scheme, pattern }, document) > 0
      || !!folder && vscode.languages.match({ scheme: uri.scheme, pattern: new vscode.RelativePattern(folder, pattern) }, document) > 0));
  const include = configuration.get<Record<string, boolean>>("readonlyInclude", {});
  const excludes = configuration.get<Record<string, boolean>>("readonlyExclude", {});
  if (uri.scheme === "file" && ignoredWorkspaceRule === readonlyPattern(uri.fsPath)
    && include[ignoredWorkspaceRule] === true) {
    const scoped = configuration.inspect<Record<string, boolean>>("readonlyInclude");
    if (scoped?.workspaceValue?.[ignoredWorkspaceRule] === true) {
      // VS Code merges objects by scope. Removing the workspace key can expose the identical user key.
      // In a single-folder window, both workspace scopes name the same .vscode/settings.json.
      const separateFolder = !!vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length !== 1;
      const keep = scoped.workspaceFolderLanguageValue?.[ignoredWorkspaceRule]
        ?? scoped.workspaceLanguageValue?.[ignoredWorkspaceRule]
        ?? scoped.globalLanguageValue?.[ignoredWorkspaceRule]
        ?? scoped.defaultLanguageValue?.[ignoredWorkspaceRule]
        ?? (separateFolder ? scoped.workspaceFolderValue?.[ignoredWorkspaceRule] : undefined)
        ?? scoped.globalValue?.[ignoredWorkspaceRule]
        ?? scoped.defaultValue?.[ignoredWorkspaceRule]
        ?? false;
      return matches({ ...include, [ignoredWorkspaceRule]: keep }) && !matches(excludes);
    }
  }
  return matches(include) && !matches(excludes);
}
