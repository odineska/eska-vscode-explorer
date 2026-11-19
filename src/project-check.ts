import { isAbsolute } from "node:path";
import * as vscode from "vscode";
import { message, type MessageKey } from "./messages.js";
import { projectArgs, projectComponent, projectProgress, saveProjectFiles, type ProjectCommandTarget } from "./project-command.js";
import type { AnalyzerSettingsHost } from "./project-file-settings.js";
import { isRecord } from "./protocol.js";
import { runtimeJson, runtimeOutput } from "./runtime-tools.js";

export interface ProjectCheckResult { text: string; error?: boolean }

function checkPath(value: unknown): string | undefined {
  if (isRecord(value) && value.encoding === "utf-8" && typeof value.value === "string" && isAbsolute(value.value)) return value.value;
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function checkDiagnostic(value: unknown, label: string): vscode.Diagnostic | undefined {
  if (!isRecord(value) || typeof value.message !== "string" || typeof value.code !== "string"
    || !count(value.start_line) || !count(value.start_column) || !count(value.end_line) || !count(value.end_column)) return;
  const severity = value.severity === "Error" ? vscode.DiagnosticSeverity.Error
    : value.severity === "Warning" ? vscode.DiagnosticSeverity.Warning
    : value.severity === "Information" ? vscode.DiagnosticSeverity.Information
    : value.severity === "Hint" ? vscode.DiagnosticSeverity.Hint : undefined;
  if (severity === undefined) return;
  const range = new vscode.Range(value.start_line, value.start_column, value.end_line, value.end_column);
  const diagnostic = new vscode.Diagnostic(range, value.message, severity);
  diagnostic.source = label;
  diagnostic.code = value.code;
  return diagnostic;
}

/** Doctor's human report already includes localized details and applicable remediation. */
export async function diagnoseProject(target: ProjectCommandTarget, signal: AbortSignal): Promise<string | undefined> {
  const args = projectArgs(target.root, "doctor", ...(target.workspace ? ["--workspace"] : []));
  const output = await runtimeOutput(target.executable, args, { signal, timeout: 120_000, maxOutputBytes: 4 * 1024 * 1024 });
  if ((output?.code === 0 || output?.code === 1) && output.stdout.trim()) return output.stdout.trim();
}

export class ProjectCheck implements vscode.Disposable {
  private readonly lifetime = new AbortController();
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("eska-project-check");
  private readonly changes = vscode.workspace.onDidChangeTextDocument(event => {
    if (event.contentChanges.length) {
      this.diagnostics.delete(event.document.uri);
      this.changedDuringRun?.add(vscode.Uri.file(event.document.uri.fsPath).fsPath);
    }
  });
  private running = false;
  private changedDuringRun: Set<string> | undefined;

  constructor(private readonly analyzer: AnalyzerSettingsHost) {}

  async run(target: ProjectCommandTarget, caller?: AbortSignal): Promise<ProjectCheckResult | undefined> {
    if (!vscode.workspace.isTrusted || this.lifetime.signal.aborted || caller?.aborted) return;
    if (this.running) return this.result("projectCheckBusy");
    this.running = true;
    try {
      const owner = caller ? AbortSignal.any([this.lifetime.signal, caller]) : this.lifetime.signal;
      const binary = await projectComponent(target, "check");
      if (!binary) return this.result("projectToolMissing", true, "eska-check");
      if (!await saveProjectFiles(target.root) || owner.aborted) return;
      this.changedDuringRun = new Set();
      const args = projectArgs(target.root, "--format", "json");
      const application = this.analyzer.application(target.root);
      if (application) args.push("--application", application);
      const analyzer = await this.analyzer.executable().catch(() => undefined);
      if (analyzer) args.push("--analyzer", analyzer);
      this.diagnostics.clear();
      const response = await projectProgress(message(vscode.env.language, "projectCheckRunning"), async signal => {
        const invoke = () => runtimeJson(binary, args, { signal, timeout: 0, maxOutputBytes: 64 * 1024 * 1024, resultExitCodes: [1] });
        let report = await invoke();
        if (!signal.aborted && isRecord(report) && isRecord(report.error) && report.error.code === "busy") {
          const restore = await this.analyzer.release(target.root);
          if (restore) {
            try { report = await invoke(); }
            finally { restore(); }
          }
        }
        return report ?? null;
      }, owner);
      if (response === undefined || owner.aborted) return;
      return this.publish(response);
    } finally {
      this.changedDuringRun = undefined;
      this.running = false;
    }
  }

  private publish(value: unknown): ProjectCheckResult {
    const label = message(vscode.env.language, "projectCheckLabel");
    if (!isRecord(value) || value.schema_version !== 1 || value.kind !== "check") return this.result("projectCheckFailed", true);
    if (value.complete !== true) {
      const error = isRecord(value.error) ? value.error : undefined;
      const code = typeof error?.code === "string" ? error.code : undefined;
      if (code === "cancelled") return this.result("projectActionCancelled");
      const stage = error && isRecord(error.data) && isRecord(error.data.failure) ? error.data.failure : undefined;
      const file = stage && checkPath(stage.path);
      if (file && code === "structure") {
        const issue = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0),
          message(vscode.env.language, "projectCheckXml"), vscode.DiagnosticSeverity.Error);
        issue.source = label;
        this.diagnostics.set(vscode.Uri.file(file), [issue]);
        void vscode.commands.executeCommand("workbench.actions.view.problems");
      }
      return code ? this.result("projectCheckFailedCode", true, code) : this.result("projectCheckFailed", true);
    }
    if (!Array.isArray(value.files) || (value.status !== "passed" && value.status !== "threshold_exceeded") || !isRecord(value.counts)) {
      return this.result("projectCheckFailed", true);
    }
    const totals = [value.counts.errors, value.counts.warnings, value.counts.information, value.counts.hints];
    if (!totals.every(count)) return this.result("projectCheckFailed", true);
    const dirty = new Set(vscode.workspace.textDocuments.filter(document => document.isDirty).map(document => vscode.Uri.file(document.uri.fsPath).fsPath));
    const rows: [vscode.Uri, vscode.Diagnostic[]][] = [];
    let findings = 0;
    for (const file of value.files) {
      if (!isRecord(file) || !Array.isArray(file.diagnostics)) return this.result("projectCheckFailed", true);
      const path = checkPath(file.path);
      if (!path) return this.result("projectCheckFailed", true);
      if (!file.diagnostics.length) continue;
      const uri = vscode.Uri.file(path);
      if (dirty.has(uri.fsPath) || this.changedDuringRun?.has(uri.fsPath)) return this.result("projectCheckChanged", true);
      const diagnostics = file.diagnostics.map(item => checkDiagnostic(item, label));
      if (diagnostics.some(entry => entry === undefined)) return this.result("projectCheckFailed", true);
      rows.push([uri, diagnostics as vscode.Diagnostic[]]);
      findings += diagnostics.length;
    }
    if (findings !== totals.reduce((a, b) => a + b, 0)) return this.result("projectCheckFailed", true);
    this.diagnostics.set(rows);
    if (rows.length) void vscode.commands.executeCommand("workbench.actions.view.problems");
    return this.result(value.status === "passed" ? "projectCheckDone" : "projectCheckThreshold", false, ...totals.map(String));
  }

  private result(key: MessageKey, error = false, ...args: string[]): ProjectCheckResult {
    return { text: message(vscode.env.language, key, ...args), error };
  }

  dispose(): void {
    this.lifetime.abort();
    this.changes.dispose();
    this.diagnostics.dispose();
  }
}
