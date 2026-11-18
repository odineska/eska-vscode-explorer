import { isAbsolute, relative } from "node:path";
import * as vscode from "vscode";
import { ApplyReview } from "./apply-review.js";
import { message, type MessageKey } from "./messages.js";
import { dirtyProjectFiles, projectArgs, projectComponent, projectProgress, saveProjectFiles, type ProjectCommandTarget } from "./project-command.js";
import { isRecord } from "./protocol.js";
import { runtimeJson } from "./runtime-tools.js";

function artifact(value: unknown) {
  if (isRecord(value) && value.path_encoding === "utf-8" && typeof value.path === "string" && isAbsolute(value.path)
    && typeof value.type === "string") return { path: value.path, type: value.type };
}

function buildPlan(value: unknown, root: string) {
  if (!isRecord(value) || value.schema_version !== 1 || value.kind !== "build-plan" || value.scope !== "project"
    || !Array.isArray(value.projects) || value.projects.length !== 1) return;
  const project: unknown = value.projects[0];
  if (!isRecord(project) || !isRecord(project.root) || project.root.path_encoding !== "utf-8"
    || typeof project.root.path !== "string" || relative(root, project.root.path) !== ""
    || !isRecord(project.platform) || typeof project.platform.found_version !== "string" || typeof project.platform.runner !== "string"
    || !isRecord(project.artifact) || typeof project.artifact.replaces_existing !== "boolean") return;
  const output = artifact(project.artifact);
  if (output) return { ...output, replaces: project.artifact.replaces_existing,
    version: project.platform.found_version, runner: project.platform.runner };
}

export class ProjectBuild implements vscode.Disposable {
  private readonly lifetime = new AbortController();
  private readonly review = new ApplyReview(vscode);
  private readonly running = new Set<string>();

  async run(target: ProjectCommandTarget): Promise<void> {
    if (!vscode.workspace.isTrusted || this.lifetime.signal.aborted) return;
    const text = (key: MessageKey, ...args: string[]) => message(vscode.env.language, key, ...args);
    if (this.running.has(target.root)) {
      void vscode.window.showInformationMessage(text("projectBuildBusy"));
      return;
    }
    this.running.add(target.root);
    try {
      const binary = await projectComponent(target, "build");
      if (!binary) {
        void vscode.window.showErrorMessage(text("projectToolMissing", "eska-build"));
        return;
      }
      if (!await saveProjectFiles(target.root)) return;
      const args = projectArgs(target.root, "build", "--format", "json");
      const planned = await projectProgress(text("projectBuildPlanning"),
        async signal => await runtimeJson(binary, [...args, "--dry-run"], { signal, timeout: 60_000 }) ?? null,
        this.lifetime.signal);
      if (planned === undefined) return;
      const plan = buildPlan(planned, target.root);
      if (!plan) {
        this.showFailure("projectBuildPlanFailed", planned);
        return;
      }
      const detail = [text("projectBuildOutput", plan.path),
        text("projectBuildPlatform", plan.version, text(plan.runner === "distrobox" ? "runtimeDistrobox" : "runtimeLocal"))];
      if (plan.replaces) detail.push("", text("projectBuildReplace"));
      if (!await this.review.show(text("projectBuildReview"), detail.join("\n"), text("projectBuildAccept"), text("projectActionCancel"))
        || this.lifetime.signal.aborted || !vscode.workspace.isTrusted) return;
      if (dirtyProjectFiles(target.root).length) {
        void vscode.window.showWarningMessage(text("projectBuildPlanChanged"));
        return;
      }
      const result = await projectProgress(text("projectBuildRunning"), async signal => {
        const current = await runtimeJson(binary, [...args, "--dry-run"], { signal, timeout: 60_000 });
        const next = buildPlan(current, target.root);
        if (!next || JSON.stringify(next) !== JSON.stringify(plan) || dirtyProjectFiles(target.root).length) return { changed: true };
        const document = await runtimeJson(binary, [...args, "--output", plan.path], { signal, timeout: 0 });
        return { changed: false, document };
      }, this.lifetime.signal);
      if (!result) return;
      if (result.changed) {
        void vscode.window.showWarningMessage(text("projectBuildPlanChanged"));
        return;
      }
      const output = isRecord(result.document) && result.document.schema_version === 1 ? artifact(result.document.artifact) : undefined;
      if (!output || output.type !== plan.type || relative(plan.path, output.path) !== "") {
        this.showFailure("projectBuildFailed", result.document);
        return;
      }
      const open = text("projectBuildReveal");
      if (await vscode.window.showInformationMessage(text("projectBuildDone", output.path), open) === open) {
        const command = vscode.env.remoteName ? "revealInExplorer" : "revealFileInOS";
        await vscode.commands.executeCommand(command, vscode.Uri.file(output.path));
      }
    } finally { this.running.delete(target.root); }
  }

  private showFailure(key: MessageKey, result: unknown): void {
    const info = isRecord(result) && isRecord(result.error) && typeof result.error.code === "string"
      ? ` (${result.error.code})` : "";
    void vscode.window.showErrorMessage(message(vscode.env.language, key) + info);
  }

  dispose(): void {
    this.lifetime.abort();
    this.review.dispose();
  }
}
