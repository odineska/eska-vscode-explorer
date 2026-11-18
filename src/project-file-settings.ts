import * as vscode from "vscode";
import { runProbe } from "./installation.js";
import { isRecord } from "./protocol.js";
import { runtimeJson } from "./runtime-tools.js";

const names = { manifest: "eska.toml", ignore: ".gitignore", attributes: ".gitattributes" } as const;
type SettingsFile = keyof typeof names;
type Operation = "show" | "preview" | "save";
type Request = { type: "project-file"; id: string; file: SettingsFile; operation: Operation; update?: unknown };

export interface AnalyzerSettingsHost {
  executable(): Promise<string | undefined>;
  application(root: string): string | undefined;
  release(root: string): Promise<(() => void) | undefined>;
}

export function projectFileRequest(value: unknown): Request | undefined {
  if (!isRecord(value) || value.type !== "project-file" || typeof value.id !== "string"
    || !/^[0-9a-f-]{36}$/.test(value.id) || typeof value.file !== "string" || !Object.hasOwn(names, value.file)
    || value.operation !== "show" && value.operation !== "preview" && value.operation !== "save") return;
  const { id, operation } = value;
  const file = value.file as SettingsFile;
  if (operation === "show") return { type: "project-file", id, operation, file };
  const { revision } = value;
  if (revision !== null && (typeof revision !== "string" || !/^[0-9a-f]{64}$/.test(revision))) return;
  if (file === "manifest" && Array.isArray(value.edits)) {
    return { type: "project-file", id, operation, file, update: { revision, edits: value.edits } };
  }
  if (file !== "manifest" && typeof value.value === "string") {
    return { type: "project-file", id, operation, file, update: { revision, value: value.value } };
  }
}

function hasUnsavedFile(root: string, file: SettingsFile): boolean {
  const target = vscode.Uri.joinPath(vscode.Uri.file(root), names[file]).fsPath;
  const normalize = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
  return vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === "file"
    && normalize(document.uri.fsPath) === normalize(target));
}

/** Every write remains bound to the file and revision chosen by the backend. */
export async function handleProjectFile(request: Request, root: string, executable: string, language: string,
  analyzer: AnalyzerSettingsHost, signal: AbortSignal): Promise<unknown> {
  const { id, file, operation, type } = request;
  const reply = { type, id, file, operation };
  const dirty = () => operation !== "show" && hasUnsavedFile(root, file);
  if (dirty()) return { ...reply, error: { code: "dirty_editor" } };
  const analyzerPath = file === "manifest" ? await analyzer.executable().catch(() => undefined) : undefined;
  const application = analyzer.application(root);
  const args = ["--lang", language.startsWith("ru") ? "ru-RU" : "en-US", "--project-dir", root,
    "settings-project", operation, "--file", file, "--format", "json"];
  if (analyzerPath && operation !== "show") args.push("--analyzer", analyzerPath);
  if (application && operation !== "show" && file === "manifest") args.push("--application", application);
  const activeRelease = operation === "save" && analyzerPath ? await analyzer.release(root) : undefined;
  try {
    if (dirty()) return { ...reply, error: { code: "dirty_editor" } };
    if (signal.aborted || !vscode.workspace.isTrusted) return;
    const [result, analyzerVersion] = await Promise.all([
      runtimeJson(executable, args, { signal, timeout: operation === "show" ? 10_000 : 145_000, input: request.update }),
      analyzerPath && operation === "show" ? versionOf(analyzerPath, root, signal) : undefined,
    ]);
    if (!isRecord(result) || result.kind !== "project-settings" || result.schema_version !== 1) {
      return { ...reply, error: { code: "unavailable" } };
    }
    if (result.status === "error" && isRecord(result.error)) {
      const data = isRecord(result.error.data) ? result.error.data : undefined;
      const analyzerData = isRecord(data?.data) ? data.data : undefined;
      return { ...reply, error: {
        code: result.error.code,
        analyzerCode: result.error.code === "analyzer_validation" ? data?.code : undefined,
        field: data?.field ?? analyzerData?.field,
      } };
    }
    if (result.status !== "ready" || result.revision !== null && typeof result.revision !== "string"
      || !(file === "manifest" ? isRecord(result.value) : typeof result.value === "string")) {
      return { ...reply, error: { code: "unavailable" } };
    }
    const metadata = operation !== "show" ? undefined : file !== "manifest" ? { gitTemplate: result.git_template } : {
      formatSchema: result.format_schema,
      formatPresets: result.format_presets,
      formatInherited: result.format_inherited,
      analyzerVersion,
    };
    return { ...reply, revision: result.revision, value: result.value, before: result.before, after: result.after,
      analyzer: result.analyzer, metadata };
  } finally {
    activeRelease?.();
  }
}

async function versionOf(executable: string, root: string, signal: AbortSignal): Promise<string | undefined> {
  const output = await runProbe(executable, ["--version"], root, 3000, 4096, signal).catch(() => undefined);
  return output ? /^bsl-analyzer (\d+\.\d+\.\d+)$/u.exec(output.stdout.trim())?.[1] : undefined;
}
