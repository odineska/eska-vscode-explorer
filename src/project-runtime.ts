import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import * as vscode from "vscode";
import { message, type MessageKey } from "./messages.js";
import { isRecord } from "./protocol.js";
import { relativeFile } from "./reveal.js";
import { runtimeJson } from "./runtime-tools.js";
import { findTool } from "./tooling/inspect.js";

export interface RuntimeProject { root: string; executable: string }
type Profile = "test" | "prod";
type Mode = "launch" | "attach";

const debugType = "eska-debug";
const errors = new Map<string, MessageKey>([
  ["missing_profile", "runtimeMissingProfile"], ["platform_unavailable", "runtimePlatformMissing"],
  ["infobase_unavailable", "runtimeInfobaseMissing"], ["baseline_changed", "runtimeBaselineChanged"],
  ["incomplete_apply", "runtimeIncomplete"], ["stale_preview", "runtimeStale"],
  ["import_failed", "runtimeImportFailed"], ["apply_failed", "runtimeApplyFailed"],
  ["secret_unavailable", "runtimeSecretMissing"], ["busy", "runtimeBusy"],
  ["missing_admin_endpoint", "runtimeAdminMissing"], ["cluster_apply_unsupported", "runtimeClusterApply"],
  ["generation_failed", "runtimeGenerationFailed"],
]);

/** Native commands resolve only project identity. The platform tools own every operation and policy check. */
export class ProjectRuntime implements vscode.Disposable {
  private readonly registrations: vscode.Disposable[];
  private readonly descriptors = new Map<string, vscode.DebugAdapterExecutable>();

  constructor(private readonly choose: (root?: string, folder?: string) => Promise<RuntimeProject | undefined>) {
    this.registrations = [
      vscode.debug.onDidStartDebugSession(session => {
        if (session.type === debugType && session.configuration.request === "attach") void this.attachTarget(session);
      }),
      vscode.commands.registerCommand("eska.explorer.attachDebugTarget", () => this.attachTarget(vscode.debug.activeDebugSession)),
      vscode.debug.registerDebugConfigurationProvider(debugType, {
        resolveDebugConfiguration: (folder, config) => this.prepareDebug(config, folder?.uri.fsPath),
      }),
      vscode.debug.registerDebugAdapterDescriptorFactory(debugType, {
        createDebugAdapterDescriptor: session => {
          const id = session.configuration.eskaSession;
          const descriptor = this.descriptors.get(id);
          this.descriptors.delete(id);
          return descriptor;
        },
      }),
    ];
  }

  async startDebug(project: RuntimeProject, mode: Mode): Promise<void> {
    const profile = await vscode.window.showQuickPick([
      { label: this.text("runtimeTest"), profile: "test" as const },
      { label: this.text("runtimeProd"), profile: "prod" as const },
    ]);
    if (!profile) return;
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.root));
    await vscode.debug.startDebugging(folder, { type: debugType, name: this.text(mode === "launch" ? "runtimeDebugLaunch" : "runtimeDebugAttach"),
      request: mode, profile: profile.profile, projectDir: project.root });
  }

  private async attachTarget(session: vscode.DebugSession | undefined): Promise<void> {
    if (!vscode.workspace.isTrusted || session?.type !== debugType) return;
    try {
      const response: unknown = await session.customRequest("eska/listDebugTargets");
      const items = isRecord(response) && Array.isArray(response.targets) ? response.targets : [];
      const targets = items.flatMap(item => isRecord(item) && typeof item.id === "string"
        && typeof item.kind === "string" && typeof item.session === "string" && typeof item.user === "string"
        ? [{ id: item.id, label: this.text("runtimeDebugTargetLabel", item.kind, item.session), description: item.user }]
        : []);
      if (!targets.length) {
        void vscode.window.showInformationMessage(this.text("runtimeNoDebugTargets"));
        return;
      }
      const target = await vscode.window.showQuickPick(targets, { placeHolder: this.text("runtimeChooseDebugTarget") });
      if (target && vscode.debug.activeDebugSession?.id === session.id) {
        await session.customRequest("eska/attachDebugTarget", { id: target.id });
      }
    } catch {
      void vscode.window.showErrorMessage(this.text("runtimeDebugTargetFailed"));
    }
  }

  async run(project: RuntimeProject): Promise<void> {
    const build = await this.tool(project, "build", "eska-build");
    if (!build) { void vscode.window.showErrorMessage(this.text("runtimeBuildMissing")); return; }
    const result = await this.invoke(project, build, ["run", "--format", "json"], 0);
    if (!isRecord(result) || result.status !== "finished") this.failure(result);
  }

  async apply(project: RuntimeProject): Promise<void> {
    const build = await this.tool(project, "build", "eska-build");
    if (!build) { void vscode.window.showErrorMessage(this.text("runtimeBuildMissing")); return; }
    const dirty = vscode.workspace.textDocuments.filter(document => document.isDirty && document.uri.scheme === "file"
      && relativeFile(project.root, document.uri.fsPath) !== undefined);
    if (dirty.length) {
      const save = this.text("runtimeSaveSources");
      if (await vscode.window.showWarningMessage(this.text("runtimeUnsavedSources"), { modal: true }, save) !== save) return;
      for (const document of dirty) if (!await document.save()) return;
    }
    let initialize = false;
    let result = await this.invoke(project, build, ["apply", "--format", "json"]);
    const error = isRecord(result) && isRecord(result.error) ? result.error.code : undefined;
    if (error === "baseline_required" || error === "baseline_changed" || error === "incomplete_apply"
      || isRecord(result) && isRecord(result.plan) && result.plan.mode === "unsupported") {
      const review = this.text("runtimeReviewFull");
      const reason = error === "baseline_changed" ? "runtimeBaselineChanged" : error === "incomplete_apply" ? "runtimeIncomplete" : "runtimeNeedsFull";
      if (await vscode.window.showWarningMessage(this.text(reason), { modal: true }, review) !== review) return;
      initialize = true;
      result = await this.invoke(project, build, ["apply", "--initialize", "--format", "json"]);
    }
    const plan = isRecord(result) && isRecord(result.plan) ? result.plan : undefined;
    if (plan?.mode === "unchanged") { void vscode.window.showInformationMessage(this.text("runtimeUnchanged")); return; }
    if (!plan || typeof plan.confirmation !== "string" || !isRecord(plan.changes)) { this.failure(result); return; }
    const paths = Object.entries(plan.changes).map(([path, change]) =>
      `${this.text(change === "added" ? "runtimeChangeAdded" : change === "removed" ? "runtimeChangeRemoved" : "runtimeChangeModified")}  ${path}`);
    const accept = this.text("runtimeApplyConfirm");
    const title = this.text(initialize ? "runtimeFullPreview" : "runtimeDeltaPreview");
    const target = typeof plan.target === "string" && typeof plan.platform_version === "string"
      ? `${plan.target} (${plan.platform_version})\n\n` : "";
    const detail = target + paths.slice(0, 40).join("\n") + (paths.length > 40 ? "\n" + this.text("runtimeAdditionalFiles", String(paths.length - 40)) : "");
    if (await vscode.window.showWarningMessage(title, { modal: true, detail }, accept) !== accept) return;
    const confirmation = plan.confirmation;
    const applied = await vscode.window.withProgress({ title: this.text("runtimeApplyWorking"),
      location: vscode.ProgressLocation.Notification, cancellable: true }, async (progress, cancel) => {
      const abort = new AbortController();
      const subscription = cancel.onCancellationRequested(() => abort.abort());
      try {
        const result = await this.invoke(project, build, ["apply", ...(initialize ? ["--initialize"] : []),
          "--confirm", confirmation, "--format", "json"], 0, abort.signal, event => {
          if (isRecord(event) && event.schema_version === 1 && event.kind === "apply_progress") {
            if (event.phase === "import") progress.report({ message: this.text("runtimeImporting") });
            if (event.phase === "apply") progress.report({ message: this.text("runtimeApplying") });
          }
        });
        return abort.signal.aborted ? null : result;
      } finally { subscription.dispose(); }
    });
    if (applied === null) return;
    if (isRecord(applied) && applied.status === "applied") void vscode.window.showInformationMessage(this.text("runtimeApplied"));
    else this.failure(applied);
  }

  private async prepareDebug(config: vscode.DebugConfiguration, folder?: string): Promise<vscode.DebugConfiguration | undefined> {
    if (!vscode.workspace.isTrusted) return undefined;
    const project = await this.choose(typeof config.projectDir === "string" ? config.projectDir : undefined, folder);
    if (!project) return undefined;
    const root = project.root;
    const binary = await this.tool(project, "debug", "eska-debug");
    if (!binary) {
      void vscode.window.showErrorMessage(this.text("runtimeDebugMissing"));
      return undefined;
    }
    const profile: Profile = config.profile === "prod" ? "prod" : "test";
    const mode: Mode = config.request === "attach" ? "attach" : "launch";
    const args = ["dap", "--profile", profile, "--mode", mode];
    if (profile === "prod") {
      const unsaved = vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === "file");
      const choice = await this.productionChoice(project, binary, unsaved);
      if (!choice) return undefined;
      if (!unsaved && vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === "file")) {
        void vscode.window.showErrorMessage(this.text("runtimeSourcesUnsaved"));
        return undefined;
      }
      if (unsaved) args.push("--unsaved");
      if (choice !== "verified") args.push("--sources", choice);
    }
    const id = randomUUID();
    this.descriptors.set(id, new vscode.DebugAdapterExecutable(binary, this.arguments(root, args), { cwd: root }));
    const timer = setTimeout(() => this.descriptors.delete(id), 30_000);
    timer.unref();
    return { type: debugType, request: mode, name: config.name || this.text("runtimeDebugLaunch"), profile, projectDir: root, eskaSession: id };
  }

  private async productionChoice(project: RuntimeProject, binary: string, unsaved: boolean): Promise<string | undefined> {
    const result = await this.invoke(project, binary, ["check", ...(unsaved ? ["--unsaved"] : [])]);
    const check = isRecord(result) && isRecord(result.check) ? result.check : undefined;
    const warning = this.text("runtimeProdWarning");
    const detail = check
      ? this.text("runtimeSourceStatus", String(check.active_branch ?? "—"), String(check.main_branch ?? "—"), String(check.remote ?? "—"))
        + (check.status === "unverified" ? "\n" + this.text("runtimeSourcesUnverified") : "")
        + (check.dirty ? "\n" + this.text("runtimeSourcesDirty") : "")
        + (unsaved ? "\n" + this.text("runtimeSourcesUnsaved") : "")
        + (typeof check.local_main_behind === "number" && typeof check.local_main_ahead === "number"
          ? "\n" + this.text("runtimeSourceDivergence", String(check.local_main_ahead), String(check.local_main_behind)) : "")
      : this.text("runtimeSourcesUnverified");
    const current = this.text(check?.status === "current" ? "runtimeStartProd" : "runtimeUseCurrent");
    const update = this.text("runtimeUpdateSources");
    const canUpdate = check?.update === "fast_forward" || check?.update === "switch_main";
    const action = await vscode.window.showWarningMessage(warning, { modal: true, detail }, current, ...(canUpdate ? [update] : []));
    if (action === current) return check?.status === "current" ? "verified" : "current";
    if (action !== update || !canUpdate) return undefined;
    const confirm = this.text("runtimeApplySourceUpdate");
    const branch = String(check.main_branch);
    const operation = this.text(check.update === "switch_main" ? "runtimeSwitchMain" : "runtimeFastForward", branch);
    if (await vscode.window.showWarningMessage(operation, { modal: true }, confirm) !== confirm) return undefined;
    if (vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === "file")) {
      void vscode.window.showErrorMessage(this.text("runtimeSourcesUnsaved"));
      return undefined;
    }
    return check.update === "switch_main" ? "switch-main" : "fast-forward";
  }

  private arguments(root: string, args: string[]): string[] {
    return ["--lang", vscode.env.language.startsWith("ru") ? "ru-RU" : "en-US", "--project-dir", root, ...args];
  }

  private invoke(project: RuntimeProject, binary: string, args: string[], timeout = 30_000, signal?: AbortSignal, onProgress?: (event: unknown) => void): Promise<unknown> {
    return runtimeJson(binary, this.arguments(project.root, args), { timeout, signal, onProgress }).catch(() => undefined);
  }

  private async tool(project: RuntimeProject, key: string, name: string): Promise<string | undefined> {
    const settings = vscode.workspace.getConfiguration("eska.explorer", vscode.Uri.file(project.root));
    return findTool(settings.get<string>(`${key}Executable`, name), name, dirname(project.executable)).catch(() => undefined);
  }

  private failure(result: unknown): void {
    const code = isRecord(result) && isRecord(result.error) ? result.error.code : undefined;
    const key = typeof code === "string" ? errors.get(code) : undefined;
    void vscode.window.showErrorMessage(this.text(key ?? "runtimeOperationFailed"));
  }

  private text(key: MessageKey, ...values: string[]): string { return message(vscode.env.language, key, ...values); }

  dispose(): void {
    this.descriptors.clear();
    for (const item of this.registrations) item.dispose();
  }
}
