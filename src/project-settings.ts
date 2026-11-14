import { randomBytes } from "node:crypto";
import { basename, dirname } from "node:path";
import * as vscode from "vscode";
import { message, type MessageKey } from "./messages.js";
import { isRecord } from "./protocol.js";
import { settingsRequest, type Infobase, type LocalSettings, type ProfileName, type SettingsResponse } from "./project-settings-protocol.js";
import { runtimeJson } from "./runtime-tools.js";
import { findTool } from "./tooling/inspect.js";

const labels = {
  title: "runtimeTitle", projectCaption: "runtimeProjectCaption",
  registeredInfobase: "runtimeRegisteredInfobase", registeredInfobaseHint: "runtimeRegisteredInfobaseHint", test: "runtimeTestTab", prod: "runtimeProdTab",
  enabled: "runtimeEnabled", disabledProfile: "runtimeDisabledProfile", prodNotice: "runtimeProdNotice",
  profiles: "runtimeProfiles", database: "runtimeDatabase", authentication: "runtimeAuthentication",
  platform: "runtimePlatform", debugging: "runtimeDebugging",
  infobase: "runtimeInfobase", file: "runtimeFile", cluster: "runtimeCluster", standalone: "runtimeStandalone",
  path: "runtimePath", host: "runtimeHost", hostHint: "runtimeHostHint", name: "runtimeName",
  url: "runtimeUrl", admin: "runtimeAdmin", runner: "runtimeRunner", local: "runtimeLocal",
  distrobox: "runtimeDistrobox", container: "runtimeContainer", version: "runtimeVersion",
  ibcmd: "runtimeIbcmd", ibcmdHint: "runtimeIbcmdHint", endpoint: "runtimeEndpoint", endpointHint: "runtimeEndpointHint",
  user: "runtimeUser", managedDebug: "runtimeManagedDebug", debugPort: "runtimeDebugPort",
  customAutoAttach: "runtimeCustomAutoAttach", autoAttach: "runtimeAutoAttach",
  epfArtifact: "runtimeEpfArtifact", epfDebugUrl: "runtimeEpfDebugUrl",
  secret: "runtimeSecret", secretHint: "runtimeSecretHint", save: "runtimeSave", saved: "runtimeSaved",
  dirty: "runtimeDirty", unchanged: "runtimeProfileUnchanged", saving: "runtimeSaving", discard: "runtimeDiscard",
  loading: "runtimeLoading", reload: "runtimeReload", reloaded: "runtimeReloaded", changed: "runtimeChanged", diskChanged: "runtimeProfileDiskChanged",
  probe: "runtimeProbe", probeHint: "runtimeProbeHint", probing: "runtimeProbing", probeSuccess: "runtimeProbeSuccess",
  probeFailure: "runtimeProbeFailure", probeStale: "runtimeProbeStale",
  invalidField: "runtimeFieldValueInvalid", invalidEndpoint: "runtimeInvalidEndpoint",
  invalidInfobaseUrl: "runtimeInvalidInfobaseUrl", invalidHost: "runtimeInvalidHost",
  invalidDebugPort: "runtimeInvalidDebugPort", invalidAdmin: "runtimeInvalidAdmin",
} satisfies Record<string, MessageKey>;

const protections = new Map<string, MessageKey>([
  ["tracked", "runtimeTracked"], ["exposed", "runtimeExposed"], ["unknown", "runtimeGitUnknown"],
  ["settings_tracked", "runtimeTracked"], ["settings_exposed", "runtimeExposed"], ["settings_git_unknown", "runtimeGitUnknown"],
  ["settings_changed", "runtimeChanged"], ["invalid_settings", "runtimeInvalid"],
]);

interface Snapshot {
  revision: string | null;
  settings: LocalSettings;
  git_protection: string;
}

/** The project component owns validation and disk writes. Private settings stay out of logs and arguments. */
export class ProjectSettings implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  show(root: string, executable: string, externalProcessing: boolean): void {
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
    let pendingWrite = false;
    const probes: Partial<Record<ProfileName, AbortController>> = {};
    let picker: { id: string; profile: ProfileName; cancellation: vscode.CancellationTokenSource } | undefined;
    const post = (response: SettingsResponse) => {
      if (!abort.signal.aborted) return panel.webview.postMessage(response);
    };
    const cancelPick = () => {
      picker?.cancellation.cancel();
      picker = undefined;
    };
    const incoming = panel.webview.onDidReceiveMessage(async (value: unknown) => {
      const request = settingsRequest(value);
      if (!request || abort.signal.aborted || !vscode.workspace.isTrusted) return;
      const { id, profile, type } = request;
      if (type === "cancelPick") {
        if (picker?.id === id && picker.profile === profile) cancelPick();
        return;
      }
      if (type === "pickInfobase") {
        cancelPick();
        const operation = { id, profile, cancellation: new vscode.CancellationTokenSource() };
        picker = operation;
        try {
          const infobase = await pickInfobase(root, executable, language, abort.signal, operation.cancellation.token)
            .catch(() => null);
          if (picker !== operation) return;
          if (infobase) await post({ type: "infobase", id, profile, infobase });
          else await post({ type: "infobase", id, profile,
            ...(infobase === null ? { detail: text("runtimeRegisteredInfobasesUnavailable") } : {}) });
        } finally {
          if (picker === operation) picker = undefined;
          operation.cancellation.dispose();
        }
        return;
      }
      if (type === "probe") {
        probes[profile]?.abort();
        const operation = new AbortController();
        probes[profile] = operation;
        const result = await probeProfile(root, executable, language, profile, request.value,
          AbortSignal.any([abort.signal, operation.signal])).catch(() => ({ ready: false, detail: text("runtimeProbeUnavailable") }));
        if (probes[profile] === operation) {
          delete probes[profile];
          await post({ type: "probe", id, profile, ...result });
        }
        return;
      }
      const error = (detail: string, field?: string, requiresReload?: boolean) =>
        post({ type: "error", id, profile, operation: type, detail, ...(field ? { field } : {}),
          ...(requiresReload ? { requiresReload } : {}) });
      if (pendingWrite) {
        await error(text("runtimeSettingsBusy"));
        return;
      }
      let update: unknown;
      if (type === "save") {
        if (!snapshot) {
          await error(text("runtimeFailed"));
          return;
        }
        const protection = protections.get(snapshot.git_protection);
        if (protection) {
          await error(text(protection));
          return;
        }
        update = { revision: snapshot.revision, settings: { ...snapshot.settings, [profile]: request.value } };
      }
      pendingWrite = true;
      try {
        const result = await readSettings(executable, root, language, abort.signal, update).catch(() => undefined);
        if (abort.signal.aborted) return;
        if (isRecord(result) && result.schema_version === 1 && result.kind === "project-local-settings"
          && result.status === "ready" && (result.revision === null || typeof result.revision === "string")
          && isRecord(result.settings) && typeof result.git_protection === "string") {
          const settings = result.settings as LocalSettings;
          snapshot = { revision: result.revision, settings, git_protection: result.git_protection };
          const warning = protections.get(snapshot.git_protection);
          await post({ type: "settings", id, profile, operation: type, settings,
            ...(warning ? { warning: text(warning) } : {}) });
          return;
        }
        const failure = settingsFailure(result);
        const field = failure.code === "invalid_field" ? failure.field : undefined;
        const key = protections.get(failure.code) ?? (failure.code === "settings_io" ? "runtimeSettingsIo"
          : failure.code === "settings_too_large" ? "runtimeSettingsTooLarge" : "runtimeFailed");
        await error(field ? text("runtimeInvalidField", failure.profile ?? profile, field) : text(key),
          failure.profile === profile ? field : undefined, failure.code === "settings_changed");
      } finally {
        pendingWrite = false;
      }
    });
    panel.onDidDispose(() => {
      abort.abort();
      cancelPick();
      incoming.dispose();
      this.panels.delete(root);
    });
    panel.webview.html = this.html(panel.webview, { labels: strings, project: basename(root), externalProcessing });
  }

  private html(webview: vscode.Webview, bootstrap: unknown): string {
    const nonce = randomBytes(16).toString("hex");
    const uri = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...parts));
    const metadata = JSON.stringify(bootstrap).replaceAll("<", "\\u003c");
    return `<!doctype html><html lang="${vscode.env.language.startsWith("ru") ? "ru" : "en"}"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource}; script-src 'nonce-${nonce}'; form-action 'none'">
      <link rel="stylesheet" href="${uri("resources", "shared", "ui.css")}">
      <link rel="stylesheet" href="${uri("resources", "settings", "settings.css")}">
      </head><body><main id="root"></main>
      <script id="settings-bootstrap" type="application/json" nonce="${nonce}">${metadata}</script>
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

function settingsFailure(value: unknown) {
  const error = isRecord(value) && isRecord(value.error) ? value.error : undefined;
  const data = isRecord(error?.data) ? error.data : undefined;
  return {
    code: typeof error?.code === "string" ? error.code : "",
    field: typeof data?.field === "string" ? data.field : undefined,
    profile: typeof data?.profile === "string" ? data.profile : undefined,
  };
}

async function probeProfile(root: string, executable: string, language: string,
  profile: ProfileName, value: Record<string, unknown>, signal: AbortSignal): Promise<{ ready: boolean; detail: string; field?: string }> {
  const text = (key: MessageKey, ...args: string[]) => message(language, key, ...args);
  const configured = vscode.workspace.getConfiguration("eska.explorer", vscode.Uri.file(root)).get<string>("buildExecutable", "eska-build");
  const build = await findTool(configured, "eska-build", dirname(executable)).catch(() => undefined);
  if (!build) return { ready: false, detail: text("runtimeBuildMissing") };
  if (signal.aborted) return { ready: false, detail: "" };
  const result = await runtimeJson(build, ["--lang", language.startsWith("ru") ? "ru-RU" : "en-US",
    "--project-dir", root, "probe", "--profile", profile, "--stdin", "--format", "json"], {
    signal, timeout: 15_000, input: value,
  });
  if (!isRecord(result) || result.schema_version !== 1 || result.kind !== "runtime_probe") {
    return { ready: false, detail: text("runtimeProbeUnavailable") };
  }
  if (result.status === "ready") return { ready: true, detail: text("runtimeProbeReady") };
  const { code, field, profile: failedProfile } = settingsFailure(result);
  if (code === "invalid_field" && failedProfile === profile && field) {
    return { ready: false, field, detail: text("runtimeInvalidField", profile, field) };
  }
  const key = code === "platform_unavailable" ? "runtimePlatformMissing"
    : code === "infobase_unavailable" ? "runtimeInfobaseMissing"
    : code === "endpoint_unavailable" ? "runtimeEndpointMissing"
    : code === "settings_too_large" ? "runtimeSettingsTooLarge"
    : code === "invalid_settings" ? "runtimeProbeInvalid"
    : "runtimeProbeUnavailable";
  return { ready: false, detail: text(key) };
}

async function pickInfobase(root: string, executable: string, language: string, signal: AbortSignal,
  token: vscode.CancellationToken) {
  const configured = vscode.workspace.getConfiguration("eska.explorer", vscode.Uri.file(root)).get<string>("debugExecutable", "eska-debug");
  const binary = await findTool(configured, "eska-debug", dirname(executable)).catch(() => undefined);
  if (!binary) return null;
  if (signal.aborted || token.isCancellationRequested) return;
  const result = await runtimeJson(binary, ["--lang", language.startsWith("ru") ? "ru-RU" : "en-US", "infobases"],
    { signal, timeout: 10_000 });
  if (signal.aborted || token.isCancellationRequested) return;
  if (!isRecord(result) || result.schema_version !== 1 || result.kind !== "registered-infobases"
    || !Array.isArray(result.entries)) return null;
  const choices = result.entries.flatMap<{ label: string; infobase: Exclude<Infobase, { kind: "standalone" }> }>(entry => {
    if (!isRecord(entry) || typeof entry.name !== "string" || !isRecord(entry.infobase)) return [];
    const base = entry.infobase;
    if (base.kind === "file" && typeof base.path === "string") {
      return [{ label: entry.name, infobase: { kind: "file", path: base.path } }];
    }
    if (base.kind === "cluster" && typeof base.host === "string" && typeof base.name === "string") {
      return [{ label: entry.name, infobase: { kind: "cluster", host: base.host, name: base.name } }];
    }
    return [];
  });
  if (!choices.length) return null;
  return (await vscode.window.showQuickPick(choices, {
    placeHolder: message(language, "runtimeRegisteredInfobase"),
  }, token))?.infobase;
}
