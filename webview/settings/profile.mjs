export const profiles = ["test", "prod"];

export function draft(profile) {
  return {
    enabled: !!profile, kind: profile?.infobase.kind ?? "file",
    path: profile?.infobase.path ?? "", host: profile?.infobase.host ?? "",
    name: profile?.infobase.name ?? "", url: profile?.infobase.url ?? "", admin: String(profile?.infobase.admin_pid ?? ""),
    runner: profile?.runner.kind ?? "local", version: profile?.runner.version ?? "",
    ibcmd: profile?.runner.ibcmd ?? "", container: profile?.runner.container ?? "",
    endpoint: profile?.debug?.url ?? "", user: profile?.authentication?.user ?? "", secret: profile?.authentication?.password_env ?? "",
    managedDebug: profile?.debug?.managed === true, debugPort: String(profile?.debug?.port ?? ""),
    epfArtifact: profile?.debug?.external_processing?.artifact ?? "",
    epfDebugUrl: profile?.debug?.external_processing?.debug_url ?? "",
    customAutoAttach: Array.isArray(profile?.debug?.auto_attach_types),
    autoAttach: profile?.debug?.auto_attach_types?.join(", ") ?? "",
  };
}

const numberValue = text => /^\d+$/.test(text) ? Number(text) : text;
export const usesManagedDebug = value => value.kind === "file" && value.managedDebug;

export function serialize(value) {
  if (!value.enabled) return null;
  const infobase = value.kind === "file" ? { kind: "file", path: value.path }
    : value.kind === "cluster" ? { kind: "cluster", host: value.host, name: value.name }
    : { kind: "standalone", url: value.url, name: value.name, admin_pid: value.admin ? numberValue(value.admin) : null };
  const runner = { kind: value.runner, version: value.version || null, ibcmd: value.ibcmd || null };
  if (value.runner === "distrobox") runner.container = value.container;
  const managed = usesManagedDebug(value);
  const debug = managed ? { managed: true } : value.endpoint ? { url: value.endpoint } : null;
  if (managed && value.debugPort) debug.port = numberValue(value.debugPort);
  if (debug && (value.epfArtifact || value.epfDebugUrl)) {
    debug.external_processing = { artifact: value.epfArtifact };
    if (value.epfDebugUrl) debug.external_processing.debug_url = value.epfDebugUrl;
  }
  if (debug && value.customAutoAttach) debug.auto_attach_types = value.autoAttach.split(",").map(kind => kind.trim()).filter(Boolean);
  return { infobase, runner, debug,
    authentication: value.user || value.secret ? { user: value.user, password_env: value.secret || null } : null };
}

// Syntax feedback only. The backend validates the declaration and checks runtime availability.
function httpUrl(text, originOnly) {
  if (!/^https?:\/\//.test(text) || /[\s\p{Cc}\\@?#]/u.test(text)) return false;
  try {
    const url = new URL(text);
    return !!url.hostname && url.port !== "0" && (!originOnly || url.protocol === "http:" && url.pathname === "/");
  } catch {
    return false;
  }
}

function positiveInteger(text, maximum) {
  return /^\d+$/.test(text) && Number(text) > 0 && Number(text) <= maximum;
}

export function formatErrors(value) {
  if (!value.enabled) return {};
  const errors = {};
  if (value.kind === "cluster" && value.host && !httpUrl("http://" + value.host, true)) errors.host = "invalidHost";
  if (value.kind === "standalone" && value.url && !httpUrl(value.url, false)) errors.url = "invalidInfobaseUrl";
  if (value.kind === "standalone" && value.admin && !positiveInteger(value.admin, 0xffffffff)) errors.admin = "invalidAdmin";
  if (usesManagedDebug(value)) {
    if (value.debugPort && !positiveInteger(value.debugPort, 65535)) errors.debugPort = "invalidDebugPort";
  } else if (value.endpoint && !httpUrl(value.endpoint, true)) {
    errors.endpoint = "invalidEndpoint";
  }
  return errors;
}

export function profileContext(value) {
  if (!value.enabled) return "";
  if (value.kind === "file") return value.path;
  return [value.kind === "cluster" ? value.host : value.url, value.name].filter(Boolean).join(" / ");
}

const fields = {
  "infobase.path": "path", "infobase.host": "host", "infobase.name": "name",
  "infobase.url": "url", "infobase.admin_pid": "admin",
  "runner.container": "container", "runner.version": "version", "runner.ibcmd": "ibcmd",
  "debug.url": "endpoint", "debug.port": "debugPort", "debug.managed": "managedDebug",
  "debug.auto_attach_types": "autoAttach", "debug.external_processing.artifact": "epfArtifact",
  "debug.external_processing.debug_url": "epfDebugUrl",
  "authentication.user": "user", "authentication.password_env": "secret",
};

export const inputField = name => Object.hasOwn(fields, name) ? fields[name] : undefined;
