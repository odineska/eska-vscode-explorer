import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { render } from "solid-js/web";
import { Button, Toolbar } from "../ui/controls.jsx";

const vscode = acquireVsCodeApi();
const profiles = ["test", "prod"];

function draft(profile) {
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

function serialize(value) {
  if (!value.enabled) return null;
  const infobase = value.kind === "file" ? { kind: "file", path: value.path }
    : value.kind === "cluster" ? { kind: "cluster", host: value.host, name: value.name }
    : { kind: "standalone", url: value.url, name: value.name, admin_pid: value.admin ? (/^[0-9]+$/.test(value.admin) ? Number(value.admin) : value.admin) : null };
  const runner = { kind: value.runner, version: value.version || null, ibcmd: value.ibcmd || null };
  if (value.runner === "distrobox") runner.container = value.container;
  const managed = value.kind === "file" && value.managedDebug;
  const debug = managed ? { managed: true } : value.endpoint ? { url: value.endpoint } : null;
  if (managed && value.debugPort) debug.port = /^\d+$/.test(value.debugPort) ? Number(value.debugPort) : value.debugPort;
  if (debug && (value.epfArtifact || value.epfDebugUrl)) {
    debug.external_processing = { artifact: value.epfArtifact };
    if (value.epfDebugUrl) debug.external_processing.debug_url = value.epfDebugUrl;
  }
  if (debug && value.customAutoAttach) debug.auto_attach_types = value.autoAttach.split(",").map(kind => kind.trim()).filter(Boolean);
  return { infobase, runner, debug,
    authentication: value.user || value.secret ? { user: value.user, password_env: value.secret || null } : null };
}

function SettingsGroup(props) {
  return <section class="settings-group" aria-labelledby={props.id}>
    <header class="group-heading">
      <h2 id={props.id}>{props.title}</h2>
      {props.action}
    </header>
    {props.children}
  </section>;
}

function App() {
  const [labels, setLabels] = createSignal({});
  const [active, setActive] = createSignal("test");
  const [busy, setBusy] = createSignal(true);
  const [notice, setNotice] = createSignal("");
  const [warning, setWarning] = createSignal("");
  const [loaded, setLoaded] = createSignal(false);
  const [externalProcessing, setExternalProcessing] = createSignal(false);
  const [drafts, setDrafts] = createStore({ test: draft(), prod: draft() });
  const profile = () => drafts[active()];
  const edit = (field, value) => { setDrafts(active(), field, value); setNotice(""); };

  window.addEventListener("message", ({ data }) => {
    if (data.type === "settings") {
      for (const name of profiles) setDrafts(name, draft(data.settings[name]));
      setLoaded(true);
      setExternalProcessing(data.externalProcessing);
      setWarning(data.warning ?? "");
      setNotice(data.saved ? data.labels.saved : "");
    } else if (data.type === "infobase") {
      const base = data.infobase;
      if (base) setDrafts(active(), { kind: base.kind, path: base.path ?? "", host: base.host ?? "",
        name: base.name ?? "", url: "", admin: "" });
      setNotice(data.detail);
    } else if (data.type === "error" || data.type === "probe") setNotice(data.detail);
    else return;
    setLabels(data.labels);
    setBusy(false);
    document.getElementById("root").setAttribute("aria-busy", "false");
  });

  const request = (type, settings) => {
    setBusy(true);
    setNotice("");
    vscode.postMessage({ type, settings, profile: active() });
  };
  const input = field => <label class="settings-field"><span>{labels()[field]}</span><input type="text" name={field} value={profile()[field]}
    onInput={event => edit(field, event.currentTarget.value)} /></label>;
  const select = (field, label, options) => <label class="settings-field"><span>{labels()[label]}</span><select name={field} value={profile()[field]}
    onChange={event => edit(field, event.currentTarget.value)}>
    <For each={options}>{option => <option value={option}>{labels()[option]}</option>}</For>
  </select></label>;
  const toggle = field => <label class="settings-toggle"><input type="checkbox" name={field} checked={profile()[field]}
    disabled={busy()} onChange={event => edit(field, event.currentTarget.checked)} />{labels()[field]}</label>;

  vscode.postMessage({ type: "load" });
  return <article class="settings-page">
    <Show when={labels().title}>
      <h1>{labels().title}</h1>
      <div class="settings-bar">
        <div class="settings-toolbar">
          <Show when={loaded()}>
            <Toolbar label={labels().profiles} class="profile-switch">
              <For each={profiles}>{name => <Button quiet aria-pressed={active() === name} disabled={busy()}
                onClick={() => setActive(name)}>{labels()[name]}</Button>}</For>
            </Toolbar>
          </Show>
          <Toolbar label={labels().title} class="settings-actions">
            <Show when={loaded()}><Button primary disabled={busy() || !!warning()} onClick={() => request("save",
              { test: serialize(drafts.test), prod: serialize(drafts.prod) })}>{labels().save}</Button></Show>
            <Show when={loaded() && profile().enabled}><Button disabled={busy()} onClick={() => request("probe")}>{labels().probe}</Button></Show>
            <Button disabled={busy()} onClick={() => request("load")}>{labels().reload}</Button>
          </Toolbar>
        </div>
        <p class="settings-notice" role="status">{notice() || warning()}</p>
      </div>
    </Show>
    <Show when={loaded()}>
      {toggle("enabled")}
      <Show when={profile().enabled}>
        <fieldset class="settings-fields" disabled={busy()} aria-label={labels()[active()]}>
          <SettingsGroup id="database" title={labels().database} action={
            <Button onClick={() => request("pickInfobase")}>{labels().registeredInfobase}</Button>
          }>
            {select("kind", "infobase", ["file", "cluster", "standalone"])}
            <Show when={profile().kind === "file"}>{input("path")}</Show>
            <Show when={profile().kind === "cluster"}>{input("host")}{input("name")}</Show>
            <Show when={profile().kind === "standalone"}>{input("url")}{input("name")}
              <Show when={active() === "test"}>{input("admin")}</Show>
            </Show>
          </SettingsGroup>
          <SettingsGroup id="authentication" title={labels().authentication}>
            {input("user")}{input("secret")}
          </SettingsGroup>
          <SettingsGroup id="platform" title={labels().platform}>
            {select("runner", "runner", ["local", "distrobox"])}
            <Show when={profile().runner === "distrobox"}>{input("container")}</Show>
            {input("version")}{input("ibcmd")}
          </SettingsGroup>
          <SettingsGroup id="debugging" title={labels().debugging}>
            <Show when={profile().kind === "file"}>{toggle("managedDebug")}</Show>
            <Show when={profile().kind === "file" && profile().managedDebug} fallback={input("endpoint")}>{input("debugPort")}</Show>
            <Show when={profile().endpoint || profile().kind === "file" && profile().managedDebug}>
              {toggle("customAutoAttach")}
              <Show when={profile().customAutoAttach}>{input("autoAttach")}</Show>
              <Show when={externalProcessing() || profile().epfArtifact || profile().epfDebugUrl}>
                {input("epfArtifact")}{input("epfDebugUrl")}
              </Show>
            </Show>
          </SettingsGroup>
        </fieldset>
      </Show>
    </Show>
  </article>;
}

render(App, document.getElementById("root"));
