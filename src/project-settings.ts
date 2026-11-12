import { randomBytes } from "node:crypto";
import { basename, dirname } from "node:path";
import * as vscode from "vscode";
import { message, type MessageKey } from "./messages.js";
import { isRecord } from "./protocol.js";
import { runtimeJson } from "./runtime-tools.js";
import { findTool } from "./tooling/inspect.js";

const labels = {
  title: "runtimeTitle", test: "runtimeTest", prod: "runtimeProd", enabled: "runtimeEnabled",
  infobase: "runtimeInfobase", file: "runtimeFile", cluster: "runtimeCluster", standalone: "runtimeStandalone",
  path: "runtimePath", host: "runtimeHost", name: "runtimeName", url: "runtimeUrl", admin: "runtimeAdmin",
  runner: "runtimeRunner", local: "runtimeLocal", distrobox: "runtimeDistrobox", container: "runtimeContainer",
  version: "runtimeVersion", ibcmd: "runtimeIbcmd", endpoint: "runtimeEndpoint", user: "runtimeUser",
  secret: "runtimeSecret", save: "runtimeSave", saved: "runtimeSaved", reload: "runtimeReload", probe: "runtimeProbe",
} satisfies Record<string, MessageKey>;

const protections = new Map<string, MessageKey>([
  ["tracked", "runtimeTracked"], ["exposed", "runtimeExposed"], ["unknown", "runtimeGitUnknown"],
  ["settings_tracked", "runtimeTracked"], ["settings_exposed", "runtimeExposed"], ["settings_git_unknown", "runtimeGitUnknown"],
  ["settings_changed", "runtimeChanged"], ["invalid_settings", "runtimeInvalid"],
]);

interface Snapshot {
  revision: string | null;
  settings: Record<string, unknown>;
  git_protection: string;
}

/** The project component owns validation and disk writes. Private settings stay out of logs and arguments. */
export class ProjectSettings implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  show(root: string, executable: string): void {
    const existing = this.panels.get(root);
    if (existing) { existing.reveal(); return; }
    const language = vscode.env.language;
    const text = (key: MessageKey, ...args: string[]) => message(language, key, ...args);
    const strings = Object.fromEntries(Object.entries(labels).map(([id, key]) => [id, text(key)]));
    const panel = vscode.window.createWebviewPanel("eska.projectSettings", `${text("runtimeTitle")} · ${basename(root)}`,
      vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "out"), vscode.Uri.joinPath(this.context.extensionUri, "resources"),
      ] });
    this.panels.set(root, panel);
    const abort = new AbortController();
    let snapshot: Snapshot | undefined;
    let pending = false;
    const incoming = panel.webview.onDidReceiveMessage(async (request: unknown) => {
      if (!isRecord(request) || pending || abort.signal.aborted || !vscode.workspace.isTrusted) return;
      if (request.type !== "load" && request.type !== "save" && request.type !== "probe") return;
      const saving = request.type === "save";
      if (saving && (!snapshot || !isRecord(request.settings) || protections.has(snapshot.git_protection))) return;
      pending = true;
      try {
        if (request.type === "probe") {
          const detail = request.profile === "test" || request.profile === "prod"
            ? await probeProfile(root, executable, language, request.profile, abort.signal) : "runtimeFailed";
          if (!abort.signal.aborted) await panel.webview.postMessage({ type: "probe", detail: text(detail), labels: strings });
          return;
        }
        const result = await readSettings(executable, root, language, abort.signal,
          saving ? { revision: snapshot?.revision, settings: request.settings } : undefined).catch(() => undefined);
        if (abort.signal.aborted) return;
        if (isRecord(result) && result.schema_version === 1 && result.kind === "project-local-settings"
          && result.status === "ready" && (result.revision === null || typeof result.revision === "string")
          && isRecord(result.settings) && typeof result.git_protection === "string") {
          snapshot = { revision: result.revision, settings: result.settings, git_protection: result.git_protection };
          const warning = protections.get(snapshot.git_protection);
          await panel.webview.postMessage({ type: "settings", settings: snapshot.settings,
            warning: warning && text(warning), saved: saving, labels: strings });
          return;
        }
        const error = isRecord(result) && isRecord(result.error) ? result.error : undefined;
        const code = typeof error?.code === "string" ? error.code : "";
        const data = isRecord(error?.data) ? error.data : undefined;
        const detail = code === "invalid_field" && typeof data?.profile === "string" && typeof data.field === "string"
          ? text("runtimeInvalidField", data.profile, data.field) : text(protections.get(code) ?? "runtimeFailed");
        await panel.webview.postMessage({ type: "error", detail, labels: strings });
      } finally {
        pending = false;
      }
    });
    panel.onDidDispose(() => {
      abort.abort();
      incoming.dispose();
      this.panels.delete(root);
    });
    panel.webview.html = this.html(panel.webview);
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString("hex");
    const uri = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...parts));
    return `<!doctype html><html lang="${vscode.env.language.startsWith("ru") ? "ru" : "en"}"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'">
      <link rel="stylesheet" href="${uri("resources", "shared", "ui.css")}">
      <link rel="stylesheet" href="${uri("resources", "settings", "settings.css")}">
      </head><body><main id="root" aria-busy="true"></main>
      <script nonce="${nonce}" src="${uri("out", "project-settings.js")}"></script></body></html>`;
  }

  dispose(): void { for (const panel of this.panels.values()) panel.dispose(); }
}

/** Only the explicitly requested JSON result is consumed. Stderr and subprocess exceptions may contain local paths. */
function readSettings(executable: string, root: string, language: string, signal: AbortSignal, update: unknown): Promise<unknown> {
  return runtimeJson(executable, ["--lang", language.startsWith("ru") ? "ru-RU" : "en-US",
    "--project-dir", root, "settings-local", update ? "save" : "show", "--format", "json"],
  { signal, timeout: 10_000, input: update });
}

async function probeProfile(root: string, executable: string, language: string,
  profile: "test" | "prod", signal: AbortSignal): Promise<MessageKey> {
  const configured = vscode.workspace.getConfiguration("eska.explorer", vscode.Uri.file(root)).get<string>("buildExecutable", "eska-build");
  const build = await findTool(configured, "eska-build", dirname(executable)).catch(() => undefined);
  if (!build) return "runtimeBuildMissing";
  const result = await runtimeJson(build, ["--lang", language.startsWith("ru") ? "ru-RU" : "en-US",
    "--project-dir", root, "probe", "--profile", profile, "--format", "json"], { signal, timeout: 15_000 });
  if (!isRecord(result) || result.kind !== "runtime_probe") return "runtimeFailed";
  if (result.status === "ready") return "runtimeProbeReady";
  switch (isRecord(result.error) ? result.error.code : undefined) {
    case "missing_profile": return "runtimeMissingProfile";
    case "platform_unavailable": return "runtimePlatformMissing";
    case "infobase_unavailable": return "runtimeInfobaseMissing";
    case "endpoint_unavailable": return "runtimeEndpointMissing";
    default: return "runtimeFailed";
  }
}
