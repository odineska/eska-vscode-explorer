import { randomUUID } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import * as vscode from "vscode";
import { message, type MessageKey } from "./messages.js";
import { isRecord } from "./protocol.js";
import { relativeFile } from "./reveal.js";
import { runtimeJson } from "./runtime-tools.js";
import { findTool } from "./tooling/inspect.js";

export interface RuntimeProject { root: string; executable: string; externalProcessing: boolean }
type Profile = "test" | "prod";
type Mode = "launch" | "attach";
type AfterApply = "run" | "debug";
interface ApplyLaunch { projectDir: string; fingerprint: string }

function applyLaunch(plan: unknown): ApplyLaunch | undefined {
  const launch = isRecord(plan) && isRecord(plan.launch) ? plan.launch : undefined;
  if (launch && typeof launch.project_dir === "string" && launch.project_dir
    && typeof launch.fingerprint === "string" && /^[0-9a-f]{64}$/.test(launch.fingerprint)) {
    return { projectDir: vscode.Uri.file(launch.project_dir).fsPath, fingerprint: launch.fingerprint };
  }
}

interface ApplicationPart {
  member: string;
  root: string;
  plan?: Record<string, unknown>;
  review?: Record<string, unknown>;
}

function applicationParts(result: unknown, application: string): ApplicationPart[] | undefined {
  if (!isRecord(result) || result.kind !== "application_apply" || result.status !== "preview"
    || !isRecord(result.plan) || result.plan.application !== application
    || !Array.isArray(result.plan.components) || !result.plan.components.length) return;
  const parts: ApplicationPart[] = [];
  for (const part of result.plan.components) {
    if (!isRecord(part) || typeof part.member !== "string" || typeof part.project_dir !== "string" || !isAbsolute(part.project_dir)) return;
    const root = vscode.Uri.file(part.project_dir).fsPath;
    if (isRecord(part.plan) && ["unchanged", "initialize", "incremental", "unsupported"].includes(String(part.plan.mode))) {
      parts.push({ member: part.member, root, plan: part.plan });
    } else if (isRecord(part.review)) {
      parts.push({ member: part.member, root, review: part.review });
    } else return;
  }
  return parts;
}

const debugType = "eska-debug";
const errors = new Map<string, MessageKey>([
  ["missing_profile", "runtimeMissingProfile"], ["platform_unavailable", "runtimePlatformMissing"],
  ["infobase_unavailable", "runtimeInfobaseMissing"], ["baseline_changed", "runtimeBaselineChanged"],
  ["incomplete_apply", "runtimeIncomplete"], ["stale_preview", "runtimeStale"],
  ["import_failed", "runtimeImportFailed"], ["apply_failed", "runtimeApplyFailed"],
  ["secret_unavailable", "runtimeSecretMissing"], ["busy", "runtimeBusy"],
  ["missing_admin_endpoint", "runtimeAdminMissing"], ["cluster_apply_unsupported", "runtimeClusterApply"],
  ["generation_failed", "runtimeGenerationFailed"],
  ["application_required", "runtimeApplicationRequired"],
  ["launch_target_changed", "runtimeLaunchTargetChanged"],
  ["extension_application_required", "runtimeApplyExtensionApplication"],
  ["extension_scope_unsupported", "runtimeApplyExtensionScope"],
  ["extension_descriptor_invalid", "runtimeApplyExtensionDescriptor"],
  ["extension_ambiguous", "runtimeApplyExtensionAmbiguous"],
  ["extension_unavailable", "runtimeApplyExtensionUnavailable"],
  ["extension_not_installed", "runtimeApplyExtensionNotInstalled"],
  ["extension_identity_mismatch", "runtimeApplyExtensionIdentity"],
  ["extension_has_dependent", "runtimeExtensionHasDependent"], ["remove_failed", "runtimeExtensionRemoveFailed"],
  ["extension_already_installed", "runtimeExtensionAlreadyInstalled"], ["extension_uuid_in_use", "runtimeExtensionUuidInUse"],
  ["extension_installation_incomplete", "runtimeExtensionInstallationIncomplete"],
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
      vscode.commands.registerCommand("eska.explorer.selectAutoAttachTypes", () => this.selectAutoAttachTypes(vscode.debug.activeDebugSession)),
      vscode.debug.registerDebugConfigurationProvider(debugType, {
        resolveDebugConfiguration: (folder, config) => this.resolveDebug(config, folder?.uri.fsPath),
      }),
      vscode.debug.registerDebugAdapterDescriptorFactory(debugType, {
        createDebugAdapterDescriptor: async session => {
          if (!vscode.workspace.isTrusted) return undefined;
          const config = session.configuration;
          const descriptor = this.descriptors.get(config.eskaSession);
          this.descriptors.delete(config.eskaSession);
          // VS Code can restart using the resolved configuration without calling its provider again.
          return descriptor ?? (await this.prepareDebug(config, session.workspaceFolder?.uri.fsPath))?.descriptor;
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
    await this.launchDebug(project, mode, profile.profile);
  }

  private async launchDebug(project: RuntimeProject, mode: Mode, profile: Profile, expectedInfobase?: string, application?: string): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project.root));
    await vscode.debug.startDebugging(folder, { type: debugType, name: this.text(mode === "launch" ? "runtimeDebugLaunch" : "runtimeDebugAttach"),
      request: mode, profile, projectDir: project.root, expectedInfobase, eskaApplication: application });
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

  private async selectAutoAttachTypes(session: vscode.DebugSession | undefined): Promise<void> {
    if (!vscode.workspace.isTrusted || session?.type !== debugType) return;
    try {
      const response: unknown = await session.customRequest("eska/getAutoAttachTypes");
      if (!isRecord(response) || !Array.isArray(response.available) || !Array.isArray(response.selected)) {
        throw new Error("invalid auto-attach types");
      }
      const selected = new Set(response.selected);
      const items = response.available.flatMap(kind => typeof kind === "string" ? [{ label: kind, picked: selected.has(kind) }] : []);
      const types = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: this.text("runtimeSelectAutoAttachTypes") });
      if (types && vscode.debug.activeDebugSession?.id === session.id) {
        await session.customRequest("eska/setAutoAttachTypes", { types: types.map(item => item.label) });
      }
    } catch {
      void vscode.window.showErrorMessage(this.text("runtimeAutoAttachFailed"));
    }
  }

  async run(project: RuntimeProject, expected?: string): Promise<void> {
    const build = await this.tool(project, "build", "eska-build");
    if (!build) { void vscode.window.showErrorMessage(this.text("runtimeBuildMissing")); return; }
    const args = ["run", "--format", "json"];
    if (expected) args.push("--expected-infobase", expected);
    const result = await this.invoke(project, build, args, 0);
    if (!isRecord(result) || result.status !== "finished") this.failure(result);
  }

  async apply(project: RuntimeProject, after?: AfterApply): Promise<void> {
    const build = await this.tool(project, "build", "eska-build");
    if (!build) { void vscode.window.showErrorMessage(this.text("runtimeBuildMissing")); return; }
    if (!await this.saveSources([project.root])) return;
    let initialize = false;
    let result = await this.invoke(project, build, ["apply", "--format", "json"]);
    const error = isRecord(result) && isRecord(result.error) ? result.error.code : undefined;
    if (error === "baseline_required" || error === "baseline_changed" || error === "incomplete_apply"
      || isRecord(result) && isRecord(result.plan) && result.plan.mode === "unsupported") {
      const review = this.text("runtimeReviewFull");
      const inspection = isRecord(result) && isRecord(result.review) && isRecord(result.review.inspection)
        ? result.review.inspection : undefined;
      const reason = error === "baseline_changed"
        ? inspection?.status === "both_changed" ? "runtimeSourcesAndDatabaseChanged" : "runtimeBaselineChanged"
        : error === "incomplete_apply" ? "runtimeIncomplete" : "runtimeNeedsFull";
      const plan = isRecord(result) && isRecord(result.plan) ? result.plan : undefined;
      const references = this.pictureReferenceLines(plan?.picture_references);
      const detail = references.slice(0, 40).join("\n")
        + (references.length > 40 ? "\n" + this.text("runtimeAdditionalFiles", String(references.length - 40)) : "");
      if (await vscode.window.showWarningMessage(this.text(reason), { modal: true, detail }, review) !== review) return;
      initialize = true;
      result = await this.invoke(project, build, ["apply", "--initialize", "--format", "json"]);
    }
    const plan = isRecord(result) && result.status === "preview" && isRecord(result.plan) ? result.plan : undefined;
    const launch = after ? applyLaunch(plan) : undefined;
    if (after && plan && (!launch || !await this.choose(launch.projectDir))) {
      void vscode.window.showErrorMessage(this.text("runtimeApplyLaunchUnavailable"));
      return;
    }
    if (plan?.mode === "unchanged") {
      if (after && launch) await this.continueAfterApply(after, launch);
      else void vscode.window.showInformationMessage(this.text("runtimeUnchanged"));
      return;
    }
    if (!plan || typeof plan.confirmation !== "string" || !isRecord(plan.changes)) { this.failure(result); return; }
    const paths = this.applyPlanPaths(plan.changes, plan.object_changes, plan.import_files);
    const accept = this.text(after === "debug" ? "runtimeApplyThenDebug" : after === "run" ? "runtimeApplyThenRun" : "runtimeApplyConfirm");
    const location = typeof plan.target === "string" && typeof plan.platform_version === "string"
      ? `${plan.target} (${plan.platform_version})` : "";
    const extension = isRecord(plan.extension) && typeof plan.extension.name === "string" && typeof plan.extension.uuid === "string"
      ? `${this.text("runtimeApplyExtension")} ${plan.extension.name} (${plan.extension.uuid})` : "";
    const title = this.text(initialize ? extension ? "runtimeFullExtensionPreview" : "runtimeFullPreview" : "runtimeDeltaPreview");
    const heading = [location, extension].filter(Boolean).join("\n");
    const target = heading ? `${heading}\n\n` : "";
    const detail = target + paths.slice(0, 40).join("\n") + (paths.length > 40 ? "\n" + this.text("runtimeAdditionalFiles", String(paths.length - 40)) : "");
    if (await vscode.window.showWarningMessage(title, { modal: true, detail }, accept) !== accept) return;
    const confirmation = plan.confirmation;
    const { result: applied, cancelled } = await this.executeWrite(project, build, [
      "apply", ...(initialize ? ["--initialize"] : []), "--confirm", confirmation, "--format", "json",
    ]);
    if (cancelled) return;
    if (!isRecord(applied) || applied.status !== "applied") { this.failure(applied); return; }
    if (!after || !launch) {
      void vscode.window.showInformationMessage(this.text("runtimeApplied"));
      return;
    }
    const confirmed = applyLaunch(applied.plan);
    if (confirmed?.projectDir !== launch.projectDir || confirmed.fingerprint !== launch.fingerprint) {
      void vscode.window.showErrorMessage(this.text("runtimeLaunchTargetChanged"));
      return;
    }
    await this.continueAfterApply(after, confirmed);
  }

  async changeExtension(project: RuntimeProject, operation: "install" | "remove"): Promise<void> {
    const build = await this.tool(project, "build", "eska-build");
    if (!build) { void vscode.window.showErrorMessage(this.text("runtimeBuildMissing")); return; }
    if (!await this.saveSources([project.root])) return;
    const installing = operation === "install";
    const args = ["extension", operation, "--format", "json"];
    const kind = installing ? "extension_install" : "extension_remove";
    const result = await this.invoke(project, build, args);
    const plan = isRecord(result) && result.schema_version === 1 && result.kind === kind
      && result.status === "preview" && isRecord(result.plan) ? result.plan : undefined;
    const extension = isRecord(plan?.extension) ? plan.extension : undefined;
    if (!plan || typeof plan.confirmation !== "string" || !/^[0-9a-f]{64}$/.test(plan.confirmation)
      || typeof plan.target !== "string" || typeof plan.platform_version !== "string"
      || typeof extension?.name !== "string" || typeof extension.uuid !== "string"
      || (installing ? !Array.isArray(plan.import_files) || !isRecord(plan.dependency_generations)
        : !(plan.extension_generation === null || typeof plan.extension_generation === "string"))) {
      this.failure(result);
      return;
    }
    const recovery = !installing && plan.extension_generation === null;
    const title = this.text(installing ? "runtimeExtensionInstallPreview"
      : recovery ? "runtimeExtensionFinalize" : "runtimeExtensionRemoveData");
    const accept = this.text(installing ? "runtimeExtensionInstallConfirm"
      : recovery ? "runtimeExtensionFinalizeConfirm" : "runtimeExtensionRemoveConfirm");
    const lines = [
      `${plan.target} (${plan.platform_version})`,
      `${this.text("runtimeApplyExtension")} ${extension.name} (${extension.uuid})`,
    ];
    if (installing && Array.isArray(plan.import_files) && isRecord(plan.dependency_generations)) {
      const dependencies = Object.keys(plan.dependency_generations);
      if (dependencies.length) lines.push(this.text("runtimeComponentDependencies", dependencies.join(", ")));
      const files = plan.import_files.filter((file): file is string => typeof file === "string");
      lines.push("", ...files.slice(0, 40));
      if (files.length > 40) lines.push(this.text("runtimeAdditionalFiles", String(files.length - 40)));
    } else if (typeof plan.extension_generation === "string") {
      lines.push(plan.extension_generation);
    }
    const detail = lines.join("\n");
    if (await vscode.window.showWarningMessage(title, { modal: true, detail }, accept) !== accept) return;
    if (this.dirtySources([project.root]).length) {
      void vscode.window.showErrorMessage(this.text("runtimeSourcesUnsaved"));
      return;
    }
    const { result: confirmed, cancelled } = await this.executeWrite(project, build,
      [...args, "--confirm", plan.confirmation, ...(installing ? [] : ["--force"])],
      installing ? "runtimeExtensionInstalling" : "runtimeExtensionRemoving");
    if (cancelled) return;
    if (!isRecord(confirmed) || confirmed.kind !== kind || confirmed.status !== (installing ? "installed" : "removed")) {
      this.failure(confirmed);
      return;
    }
    void vscode.window.showInformationMessage(this.text(installing ? "runtimeExtensionInstalled" : "runtimeExtensionRemoved"));
  }

  async applyApplication(project: RuntimeProject, after?: AfterApply, current?: string): Promise<void> {
    const application = await this.chooseApplication(project, current);
    if (!application || !vscode.workspace.isTrusted) return;
    const build = await this.tool(project, "build", "eska-build");
    if (!build) { void vscode.window.showErrorMessage(this.text("runtimeBuildMissing")); return; }
    const args = ["apply", "--application", application, "--format", "json"];
    const preview = async () => {
      const { result, cancelled } = await this.executeWrite(project, build, args, "runtimeApplicationPlanning");
      return cancelled ? null : result;
    };
    let result = await preview();
    if (result === null) return;
    let parts = applicationParts(result, application);
    if (!parts) { this.failure(result); return; }

    const roots = parts.map(part => part.root);
    if (this.dirtySources(roots).length) {
      if (!await this.saveSources(roots)) return;
      result = await preview();
      if (result === null) return;
      parts = applicationParts(result, application);
      if (!parts) { this.failure(result); return; }
    }
    let detail = this.applicationDetail(parts);
    if (parts.some(part => !part.plan || part.plan.mode === "unsupported")) {
      const review = this.text("runtimeReviewFull");
      if (await vscode.window.showWarningMessage(this.text("runtimeApplicationNeedsFull", application),
        { modal: true, detail }, review) !== review) return;
      args.push("--initialize");
      result = await preview();
      if (result === null) return;
      parts = applicationParts(result, application);
      if (!parts) { this.failure(result); return; }
      detail = this.applicationDetail(parts);
    }
    if (!isRecord(result) || !isRecord(result.plan)) return;
    const launch = after ? applyLaunch(result.plan) : undefined;
    if (after && (!launch || !await this.choose(launch.projectDir))) {
      void vscode.window.showErrorMessage(this.text("runtimeApplyLaunchUnavailable"));
      return;
    }
    if (parts.every(part => part.plan?.mode === "unchanged")) {
      if (this.dirtySources(parts.map(part => part.root)).length) {
        void vscode.window.showErrorMessage(this.text("runtimeStale"));
        return;
      }
      if (after && launch) await this.continueAfterApply(after, launch, application);
      else void vscode.window.showInformationMessage(this.text("runtimeUnchanged"));
      return;
    }
    if (typeof result.plan.confirmation !== "string") { this.failure(result); return; }
    const accept = this.text(after === "debug" ? "runtimeApplyThenDebug" : after === "run" ? "runtimeApplyThenRun" : "runtimeApplyConfirm");
    if (await vscode.window.showWarningMessage(this.text("runtimeApplicationPreview", application),
      { modal: true, detail }, accept) !== accept) return;
    if (!vscode.workspace.isTrusted) return;
    if (this.dirtySources(parts.map(part => part.root)).length) {
      void vscode.window.showErrorMessage(this.text("runtimeStale"));
      return;
    }
    const { result: applied, cancelled } = await this.executeWrite(project, build, [...args, "--confirm", result.plan.confirmation]);
    const outcomes = isRecord(applied) && applied.kind === "application_apply" && Array.isArray(applied.outcomes) ? applied.outcomes : [];
    const complete = outcomes.length === parts.length && outcomes.every((outcome, index) => isRecord(outcome)
      && outcome.member === parts[index]?.member && (outcome.status === "applied" || outcome.status === "unchanged"));
    if (cancelled || !isRecord(applied) || applied.status !== "applied" || !complete) {
      const statuses = outcomes.flatMap(outcome => {
        if (!isRecord(outcome) || typeof outcome.member !== "string") return [];
        const key = outcome.status === "applied" ? "runtimeComponentApplied" : outcome.status === "failed" ? "runtimeComponentFailed"
          : outcome.status === "not_started" ? "runtimeComponentNotStarted"
          : outcome.status === "unchanged" ? "runtimeComponentUnchanged" : undefined;
        return key ? [`${outcome.member} — ${this.text(key)}`] : [];
      });
      if (!cancelled && !statuses.length) { this.failure(applied); return; }
      const title = cancelled ? this.text("runtimeApplicationCancelled") : this.failureMessage(applied);
      await vscode.window.showWarningMessage(title, { modal: true, detail: [...statuses, this.text("runtimeApplicationRetry")].join("\n") });
      return;
    }
    if (!after || !launch) { void vscode.window.showInformationMessage(this.text("runtimeApplied")); return; }
    const confirmed = applyLaunch(applied);
    if (confirmed?.projectDir !== launch.projectDir || confirmed.fingerprint !== launch.fingerprint) {
      void vscode.window.showErrorMessage(this.text("runtimeLaunchTargetChanged"));
      return;
    }
    await this.continueAfterApply(after, confirmed, application);
  }

  private async chooseApplication(project: RuntimeProject, current?: string): Promise<string | undefined> {
    const response = await this.invoke(project, project.executable, [
      "context", "--format", "json", ...(current ? ["--application", current] : []),
    ]);
    const error = isRecord(response) && isRecord(response.error) ? response.error : undefined;
    const available = error && isRecord(error.data) && Array.isArray(error.data.available)
      ? error.data.available.filter((name): name is string => typeof name === "string" && !!name) : [];
    const prompt = this.text("runtimeChooseApplication");
    if (available.length) return vscode.window.showQuickPick(available, { placeHolder: prompt, ignoreFocusOut: true });
    const context = isRecord(response) && isRecord(response.context) ? response.context : undefined;
    if (context?.name === null) {
      void vscode.window.showErrorMessage(this.text("runtimeApplicationRequired"));
      return;
    }
    const entered = await vscode.window.showInputBox({ title: prompt, prompt: this.text("runtimeChooseApplicationHint"),
      value: typeof context?.name === "string" ? context.name : current ?? "", ignoreFocusOut: true });
    return entered?.trim() || undefined;
  }

  private applicationDetail(parts: ApplicationPart[]): string {
    const target = parts.find(part => part.plan)?.plan;
    const lines = target && typeof target.target === "string" && typeof target.platform_version === "string"
      ? [`${target.target} (${target.platform_version})`, ""] : [];
    let remaining = 40;
    let omitted = 0;
    for (const part of parts) {
      const mode = part.plan?.mode;
      const status = mode === "unchanged" ? "runtimeComponentUnchanged" : mode === "incremental" ? "runtimeComponentPartial"
        : mode === "initialize" ? "runtimeComponentFull"
        : part.review?.reason === "incomplete" ? "runtimeIncomplete"
        : part.review?.reason === "baseline_changed" ? "runtimeBaselineChanged" : "runtimeNeedsFull";
      lines.push(`${part.member} — ${this.text(status)}`);
      const inspection = part.plan?.inspection;
      const dependencies = isRecord(inspection) && isRecord(inspection.dependency_generations)
        ? Object.keys(inspection.dependency_generations) : [];
      if (dependencies.length) lines.push(`  ${this.text("runtimeComponentDependencies", dependencies.join(", "))}`);
      const changes = part.plan?.changes ?? part.review?.changes;
      const paths = isRecord(changes) ? this.applyPlanPaths(changes, part.plan?.object_changes, part.plan?.import_files) : [];
      const files = this.pictureReferenceLines(part.plan?.picture_references).concat(paths);
      lines.push(...files.slice(0, remaining).map(path => `  ${path}`));
      const shown = Math.min(remaining, files.length);
      remaining -= shown;
      omitted += files.length - shown;
    }
    if (omitted) lines.push(this.text("runtimeAdditionalFiles", String(omitted)));
    return lines.join("\n");
  }

  private dirtySources(roots: readonly string[]): vscode.TextDocument[] {
    return vscode.workspace.textDocuments.filter(document => document.isDirty && document.uri.scheme === "file"
      && roots.some(root => relativeFile(root, document.uri.fsPath) !== undefined));
  }

  private async saveSources(roots: readonly string[]): Promise<boolean> {
    const dirty = this.dirtySources(roots);
    if (!dirty.length) return true;
    const save = this.text("runtimeSaveSources");
    if (await vscode.window.showWarningMessage(this.text("runtimeUnsavedSources"), { modal: true }, save) !== save) return false;
    for (const document of dirty) if (!await document.save()) return false;
    return true;
  }

  private executeWrite(project: RuntimeProject, build: string, args: string[], title: MessageKey = "runtimeApplyWorking"): Thenable<{ result?: unknown; cancelled: boolean }> {
    return vscode.window.withProgress({ title: this.text(title),
      location: vscode.ProgressLocation.Notification, cancellable: true }, async (progress, cancel) => {
      const abort = new AbortController();
      const subscription = cancel.onCancellationRequested(() => abort.abort());
      try {
        if (cancel.isCancellationRequested) return { cancelled: true };
        const result = await this.invoke(project, build, args, 0, abort.signal, event => {
          if (!isRecord(event) || event.schema_version !== 1 || (event.kind !== "apply_progress" && event.kind !== "extension_progress")) return;
          const key = event.phase === "import" ? "runtimeImporting" : event.phase === "apply" ? "runtimeApplying" : undefined;
          if (!key) return;
          const message = this.text(key);
          progress.report({ message: typeof event.component === "string" ? `${event.component} — ${message}` : message });
        });
        return { result, cancelled: abort.signal.aborted };
      } finally { subscription.dispose(); }
    });
  }

  private async continueAfterApply(after: AfterApply, launch: ApplyLaunch, application?: string): Promise<void> {
    const project = await this.choose(launch.projectDir);
    if (!project) {
      void vscode.window.showErrorMessage(this.text("runtimeApplyLaunchUnavailable"));
      return;
    }
    if (after === "debug") await this.launchDebug(project, "launch", "test", launch.fingerprint, application);
    else await this.run(project, launch.fingerprint);
  }

  private pictureReferenceLines(paths: unknown): string[] {
    return Array.isArray(paths) ? paths.flatMap(path => typeof path === "string"
      ? [this.text("runtimeApplyPictureReference", path)] : []) : [];
  }

  private applyPlanPaths(changes: Record<string, unknown>, objects: unknown, files: unknown): string[] {
    const paths: string[] = [];
    const grouped = new Set<string>();
    if (Array.isArray(objects)) {
      for (const object of objects) {
        if (!isRecord(object) || typeof object.name !== "string" || !Array.isArray(object.paths)) continue;
        const kind = object.kind === "language" ? "runtimeObjectLanguage"
          : object.kind === "common_form" ? "runtimeObjectCommonForm"
            : object.kind === "role" ? "runtimeObjectRole"
              : object.kind === "common_module" ? "runtimeObjectCommonModule"
                : object.kind === "common_picture" ? "runtimeObjectCommonPicture" : undefined;
        const action = object.operation === "added" ? "runtimeChangeAdded"
          : object.operation === "removed" ? "runtimeChangeRemoved"
          : object.operation === "renamed" ? "runtimeChangeRenamed" : undefined;
        if (!kind || !action || (action === "runtimeChangeRenamed" && typeof object.previous_name !== "string")) continue;
        const name = action === "runtimeChangeRenamed" ? `${object.previous_name} → ${object.name}` : object.name;
        paths.push(`${this.text(action)} ${this.text(kind)} ${name}`);
        for (const path of object.paths) {
          if (typeof path === "string" && Object.hasOwn(changes, path)) {
            grouped.add(path);
            paths.push(`  ${path}`);
          }
        }
      }
    }
    for (const [path, change] of Object.entries(changes)) {
      if (grouped.has(path)) continue;
      const label = change === "added" ? "runtimeChangeAdded" : change === "removed" ? "runtimeChangeRemoved" : "runtimeChangeModified";
      paths.push(`${this.text(label)}  ${path}`);
    }
    if (Array.isArray(files)) {
      for (const path of files) {
        if (typeof path === "string" && !Object.hasOwn(changes, path)) {
          paths.push(`${this.text("runtimeApplyCompanion")}  ${path}`);
        }
      }
    }
    return paths;
  }

  private async resolveDebug(config: vscode.DebugConfiguration, folder?: string): Promise<vscode.DebugConfiguration | undefined> {
    const prepared = await this.prepareDebug(config, folder);
    if (!prepared) return undefined;
    const { root, profile, mode, descriptor, expectedInfobase, application } = prepared;
    const id = randomUUID();
    this.descriptors.set(id, descriptor);
    const timer = setTimeout(() => this.descriptors.delete(id), 30_000);
    timer.unref();
    return { type: debugType, request: mode, name: config.name || this.text("runtimeDebugLaunch"), profile, projectDir: root, eskaSession: id, expectedInfobase, eskaApplication: application };
  }

  private async prepareDebug(config: vscode.DebugConfiguration, folder?: string) {
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
    const expectedInfobase = typeof config.expectedInfobase === "string" ? config.expectedInfobase : undefined;
    if (expectedInfobase !== undefined) {
      if (profile !== "test" || mode !== "launch" || !/^[0-9a-f]{64}$/.test(expectedInfobase)) return undefined;
      args.push("--expected-infobase", expectedInfobase);
    }
    const application = typeof config.eskaApplication === "string" ? config.eskaApplication : undefined;
    if (application !== undefined) {
      if (!expectedInfobase || !application.trim() || application.includes("\0")) return undefined;
      args.push("--application", application);
    }
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
    const descriptor = new vscode.DebugAdapterExecutable(binary, this.arguments(root, args), { cwd: root });
    return { root, profile, mode, descriptor, expectedInfobase, application };
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

  private failureMessage(result: unknown): string {
    const error = isRecord(result) && isRecord(result.error) ? result.error : undefined;
    const key = typeof error?.code === "string" ? errors.get(error.code) : undefined;
    if (key === "runtimeExtensionHasDependent") {
      return typeof error?.dependent === "string" && error.dependent.length > 0
        ? this.text(key, error.dependent)
        : this.text("runtimeOperationFailed");
    }
    if (key === "runtimeApplyExtensionNotInstalled" || key === "runtimeExtensionAlreadyInstalled"
      || key === "runtimeExtensionUuidInUse" || key === "runtimeExtensionInstallationIncomplete") {
      return typeof error?.extension === "string" && error.extension.length > 0
        ? this.text(key, error.extension)
        : this.text("runtimeApplyExtensionUnavailable");
    }
    return this.text(key ?? "runtimeOperationFailed");
  }

  private failure(result: unknown): void {
    void vscode.window.showErrorMessage(this.failureMessage(result));
  }

  private text(key: MessageKey, ...values: string[]): string { return message(vscode.env.language, key, ...values); }

  dispose(): void {
    this.descriptors.clear();
    for (const item of this.registrations) item.dispose();
  }
}
