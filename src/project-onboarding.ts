import { operationHistory } from "./operation-output.js";
import { OperationProgress } from "./operation-progress.js";
import * as vscode from "vscode";
import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { homedir } from "node:os";
import { findTool } from "./tooling/inspect.js";
import { runtimeJson, runtimeOutput } from "./runtime-tools.js";

const en = {
  title: "Start a 1C project", new: "Create a new project", artifact: "Create from CF / CFE / EPF / ERF", init: "Connect Designer XML sources", clone: "Clone a Git project",
  configuration: "Configuration", extension: "Extension", processing: "Data processor", report: "Report", type: "Choose the project type", archive: "Choose the 1C artifact", parent: "Choose the parent directory", directory: "New project directory name", invalid: "Enter a single directory name without path separators.",
  target: "Choose the project directory", source: "Choose the Designer XML source directory inside the project", inside: "The source directory must be inside the selected project directory.", repository: "Git repository URL or local path", repositoryInvalid: "Enter a repository URL or path that does not start with a dash.",
  exists: "The destination already exists. Choose a new directory; existing projects are never overwritten.", manifest: "This directory already has eska.toml. Open the existing project instead.",
  confirm: "Run this project setup?", apply: "Set up project", failed: "Project setup failed or was interrupted. Check the destination before retrying. The selected ESKA CLI and required platform must be installed and configured.",
  missing: "ESKA CLI is unavailable. Install ESKA or configure the eska-project executable path.", trust: "Trust this workspace before setting up projects.", running: "ESKA: Setting up project…", busy: "Project setup is already running.", unsupported: "Select a local file or directory.",
  platform: "Choose the 1C platform", later: "Choose later", laterArtifact: "Use an installed platform for unpacking without saving a version", host: "Host", distrobox: "Distrobox",
  workflow: "Choose the project workflow", trunk: "Trunk", githubFlow: "GitHub Flow", gitFlow: "Git Flow", custom: "Custom",
  cancelled: "Project setup was cancelled. Check the destination before retrying.",
};
const ru: Record<keyof typeof en, string> = {
  title: "Начать проект 1С", new: "Создать новый проект", artifact: "Создать из CF / CFE / EPF / ERF", init: "Подключить исходники Designer XML", clone: "Клонировать Git-проект",
  configuration: "Конфигурация", extension: "Расширение", processing: "Обработка", report: "Отчёт", type: "Выберите тип проекта", archive: "Выберите файл 1С", parent: "Выберите родительский каталог", directory: "Имя каталога нового проекта", invalid: "Введите одно имя каталога без разделителей пути.",
  target: "Выберите каталог проекта", source: "Выберите каталог исходников Designer XML внутри проекта", inside: "Каталог исходников должен находиться внутри выбранного каталога проекта.", repository: "URL Git-репозитория или локальный путь", repositoryInvalid: "Введите URL или путь репозитория, не начинающийся с дефиса.",
  exists: "Целевой каталог уже существует. Выберите новый каталог: существующие проекты не перезаписываются.", manifest: "В каталоге уже есть eska.toml. Откройте существующий проект.",
  confirm: "Выполнить настройку проекта?", apply: "Настроить проект", failed: "Настройка проекта завершилась ошибкой или была прервана. Проверьте целевой каталог перед повтором. Выбранная ESKA CLI и необходимая платформа должны быть установлены и настроены.",
  missing: "Не найдена ESKA CLI. Установите ESKA или настройте путь к eska-project.", trust: "Для настройки проектов разрешите доверие к рабочей области.", running: "ESKA: Настройка проекта…", busy: "Настройка проекта уже выполняется.", unsupported: "Выберите локальный файл или каталог.",
  platform: "Выберите платформу 1С", later: "Выбрать позже", laterArtifact: "Использовать установленную платформу для распаковки без сохранения версии", host: "Хост", distrobox: "Distrobox",
  workflow: "Выберите процесс работы с проектом", trunk: "Trunk", githubFlow: "GitHub Flow", gitFlow: "Git Flow", custom: "Свой процесс",
  cancelled: "Настройка отменена. Проверьте целевой каталог перед повтором.",
};
type Action = "new" | "artifact" | "init" | "clone";
export type ProjectType = "configuration" | "extension" | "processing" | "report";
export interface OnboardingPlan { action: Action; target: string; source?: string; artifact?: string; repository?: string; type?: ProjectType }
export function validProjectDirectory(value: string): boolean {
  return !!value.trim() && value === value.trim() && value !== "." && value !== ".." && !/[\\/\x00-\x1f<>:"|?*]/.test(value) && !/[. ]$/.test(value)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}
export function onboardingArguments(plan: OnboardingPlan): string[] {
  switch (plan.action) {
    case "new": return ["new", plan.target, "--type", plan.type!];
    case "artifact": return ["new", plan.target, "--from", plan.artifact!];
    case "init": return ["init", plan.target, "--source", relative(plan.target, plan.source!) || "."];
    case "clone": return ["clone", plan.repository!, plan.target];
  }
}
interface PlatformChoice { label: string; description?: string; detail?: string; version: string; ibcmd?: string; container?: string }
/** Interpret only the versioned Rust inventory contract; discovery belongs to eska-build. */
export function installedPlatformChoices(value: unknown, host: string, distrobox: string): PlatformChoice[] {
  const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
  if (!record(value) || value.schema_version !== 1 || value.kind !== "installed-platforms" || !Array.isArray(value.platforms)) return [];
  return value.platforms.flatMap((entry: unknown) => {
    if (!record(entry) || typeof entry.version !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(entry.version)
      || typeof entry.ibcmd !== "string" || !entry.ibcmd || !record(entry.source)) return [];
    const source = entry.source;
    if (source.kind !== "host" && !(source.kind === "distrobox" && typeof source.container === "string" && source.container)) return [];
    const container = source.kind === "distrobox" ? source.container as string : undefined;
    return [{ label: entry.version, description: container ? `${distrobox} (${container})` : host,
      detail: entry.ibcmd, version: entry.version, ibcmd: entry.ibcmd, ...(container ? { container } : {}) }];
  });
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

/** The native wizard remains available without a connected metadata backend or workspace folder. */
export function registerProjectOnboarding(_context: vscode.ExtensionContext): vscode.Disposable {
  let controller: AbortController | undefined, disposed = false;
  const text = (key: keyof typeof en) => (vscode.env.language.startsWith("ru") ? ru : en)[key];
  const folder = async (title: keyof typeof en): Promise<string | undefined> => {
    const selected = (await vscode.window.showOpenDialog({ title: text(title), canSelectFiles: false, canSelectFolders: true, canSelectMany: false }))?.[0];
    if (selected && selected.scheme !== "file") throw new Error(text("unsupported"));
    return selected ? realpath(selected.fsPath) : undefined;
  };
  const registration = vscode.commands.registerCommand("eska.explorer.projectOnboarding", async () => {
    if (controller) { void vscode.window.showInformationMessage(text("busy")); return; }
    if (!vscode.workspace.isTrusted) { void vscode.window.showErrorMessage(text("trust")); return; }
    const operation = new AbortController(); controller = operation;
    try {
      const choice = await vscode.window.showQuickPick((["new", "artifact", "init", "clone"] as const).map(action => ({ label: text(action), action })), { title: text("title") });
      if (!choice || disposed) return;
      const plan: OnboardingPlan = { action: choice.action, target: "" };
      if (plan.action === "new") {
        const type = await vscode.window.showQuickPick((["configuration", "extension", "processing", "report"] as const).map(type => ({ label: text(type), type })), { title: text("type") });
        if (!type) return; plan.type = type.type;
      } else if (plan.action === "artifact") {
        const file = (await vscode.window.showOpenDialog({ title: text("archive"), canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { "1C": ["cf", "cfe", "epf", "erf"] } }))?.[0];
        if (!file) return;
        if (file.scheme !== "file") throw new Error(text("unsupported"));
        plan.artifact = file.fsPath;
      } else if (plan.action === "clone") {
        const repository = await vscode.window.showInputBox({ title: text("repository"), ignoreFocusOut: true, validateInput: value => value.trim() && !value.trim().startsWith("-") && !/[\x00\r\n]/.test(value) ? undefined : text("repositoryInvalid") });
        if (!repository) return; plan.repository = repository.trim();
      }
      if (plan.action === "init") {
        const target = await folder("target"); if (!target) return;
        plan.target = target;
        if (await exists(join(target, "eska.toml"))) throw new Error(text("manifest"));
        const source = await folder("source"); if (!source) return;
        const path = relative(target, source);
        if (isAbsolute(path) || path.split(sep).includes("..")) throw new Error(text("inside"));
        plan.source = source;
      } else {
        const parent = await folder("parent"); if (!parent) return;
        const name = await vscode.window.showInputBox({ title: text("directory"), ignoreFocusOut: true, validateInput: value => validProjectDirectory(value) ? undefined : text("invalid") });
        if (!name) return;
        if (!validProjectDirectory(name)) throw new Error(text("invalid"));
        plan.target = join(parent, name);
        if (await exists(plan.target)) throw new Error(text("exists"));
      }
      const settings = vscode.workspace.getConfiguration("eska.explorer");
      const configured = settings.get<string>("executable", "eska-project");
      const managed = join(homedir(), ".eska", "bin");
      const project = await findTool(configured, "eska-project", managed);
      const sibling = project ? dirname(project) : isAbsolute(configured) ? dirname(configured) : managed;
      const wrapper = await findTool("eska", "eska", sibling);
      const component = wrapper ?? (plan.action === "clone" ? await findTool("eska-vcs", "eska-vcs", sibling) : plan.action === "artifact" ? undefined : project);
      if (!component) throw new Error(text("missing"));
      const args = onboardingArguments(plan);
      let workflow: string | undefined;
      if (wrapper && plan.action !== "clone") {
        const selected = await vscode.window.showQuickPick([
          { label: text("trunk"), value: "trunk" }, { label: text("githubFlow"), value: "github-flow" },
          { label: text("gitFlow"), value: "git-flow" }, { label: text("custom"), value: "custom" },
        ], { title: text("workflow") });
        if (!selected) return;
        workflow = selected.value; args.push("--workflow", workflow);
      }
      let platformVersion: string | undefined;
      if (plan.action !== "clone") {
        const buildConfigured = settings.get<string>("buildExecutable", "eska-build");
        const build = await findTool(buildConfigured, "eska-build", sibling).catch(() => undefined);
        const inventory = build ? await runtimeJson(build, ["--lang", vscode.env.language.startsWith("ru") ? "ru-RU" : "en-US",
          "platform", "list", "--include-distrobox", "--format", "json"], { timeout: 20_000, signal: operation.signal }).catch(() => undefined) : undefined;
        if (disposed || operation.signal.aborted) return;
        const items = installedPlatformChoices(inventory, text("host"), text("distrobox"));
        items.push({ label: text("later"), ...(plan.action === "artifact" ? { description: text("laterArtifact") } : {}), version: "" });
        const platform = await vscode.window.showQuickPick(items, { title: text("platform"), matchOnDescription: true, matchOnDetail: true });
        if (!platform) return;
        platformVersion = platform.version;
        args.push("--platform-version", platformVersion);
        if (wrapper && platform.ibcmd) args.push("--ibcmd", platform.ibcmd);
        if (wrapper && platform.container) args.push("--distrobox", platform.container);
      }
      const detail = [plan.target, workflow, platformVersion, plan.type ? text(plan.type) : undefined, plan.source, plan.artifact, plan.repository].filter(Boolean).join("\n");
      if (await vscode.window.showWarningMessage(text("confirm"), { modal: true, detail }, text("apply")) !== text("apply")) return;
      if (disposed || operation.signal.aborted) return;
      if (!vscode.workspace.isTrusted) throw new Error(text("trust"));
      if (await exists(plan.action === "init" ? join(plan.target, "eska.toml") : plan.target)) throw new Error(text(plan.action === "init" ? "manifest" : "exists"));
      const output = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: text("running"), cancellable: true }, async (reporter, token) => {
        const progress = new OperationProgress(vscode.env.language, message => reporter.report({ message }), undefined, line => operationHistory(vscode, line));
        const listener = token.onCancellationRequested(() => operation.abort());
        try { return await runtimeOutput(component, ["--project-dir", plan.action === "init" ? plan.target : dirname(plan.target), "--lang", vscode.env.language.startsWith("ru") ? "ru-RU" : "en-US", ...args], { timeout: 0, signal: operation.signal, onProgress: event => progress.event(event) }); }
        finally { progress.dispose(); listener.dispose(); }
      });
      if (disposed) return;
      if (operation.signal.aborted) throw new Error(text("cancelled"));
      if (!output || output.code !== 0) throw new Error(text("failed"));
      await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(plan.target), { forceNewWindow: true });
    } catch (error) { if (!disposed) void vscode.window.showErrorMessage(error instanceof Error && Object.values(vscode.env.language.startsWith("ru") ? ru : en).includes(error.message) ? error.message : text("failed")); }
    finally { if (controller === operation) controller = undefined; }
  });
  return { dispose() { disposed = true; controller?.abort(); registration.dispose(); } };
}
