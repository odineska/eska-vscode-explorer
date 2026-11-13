import { For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { render } from "solid-js/web";
import { Button } from "../ui/controls.jsx";
import { settingsController } from "./controller.js";
import { profileContext, profiles, usesManagedDebug } from "./profile.mjs";

const api = acquireVsCodeApi();
const { labels, project, externalProcessing } = JSON.parse(document.getElementById("settings-bootstrap").textContent);

function Icon(props) {
  return <span class="settings-icon" data-icon={props.name} aria-hidden="true"/>;
}

function Profiles(props) {
  const model = props.model;
  return <nav class="settings-profiles" aria-label={labels.profiles}>
    <For each={profiles}>{name => <Button quiet class="settings-profile" data-profile={name}
      aria-pressed={model.active() === name}
      aria-label={[labels[name], name, model.dirty(name) && labels.dirty].filter(Boolean).join(", ")}
      onClick={() => model.select(name)}>
      <Icon name={name === "test" ? "data-processor" : "storage"}/>
      <span>{labels[name]}</span><code class="settings-badge" data-profile={name}>{name}</code>
      <span class="settings-dirty-dot" classList={{ "is-dirty": model.dirty(name) }} title={model.dirty(name) ? labels.dirty : undefined} aria-hidden="true"/>
    </Button>}</For>
  </nav>;
}

function Section(props) {
  return <section class="settings-group" aria-labelledby={props.id}>
    <header class="group-heading">
      <h2 id={props.id}><Icon name={props.icon}/>{props.title}</h2>
      {props.action}
    </header>
    <div class="settings-controls">{props.children}</div>
  </section>;
}

function TextField(props) {
  const field = props.name;
  const id = "settings-" + field;
  const error = () => props.model.fieldError(field, labels);
  const description = () => [props.hint && id + "-hint", error() && id + "-error"].filter(Boolean).join(" ") || undefined;
  return <div class="settings-field">
    <label class="settings-label" for={id}>{labels[field]}</label>
    <input id={id} name={field} classList={{ "eska-code": field !== "user" }}
      type={props.url ? "url" : "text"} inputmode={props.numeric ? "numeric" : undefined}
      autocomplete="off" spellcheck="false"
      aria-describedby={description()} aria-invalid={error() ? "true" : undefined}
      value={props.model.current().draft[field]}
      onInput={event => props.model.edit(field, event.currentTarget.value)}
      onBlur={() => props.model.visit(field)}/>
    <Show when={props.hint}><span class="settings-hint" id={id + "-hint"}>{props.hint}</span></Show>
    <Show when={error()}><span class="settings-field-error" id={id + "-error"}>{error()}</span></Show>
  </div>;
}

function SelectField(props) {
  const id = "settings-" + props.name;
  return <div class="settings-field">
    <label class="settings-label" for={id}>{props.label}</label>
    <select id={id} name={props.name} value={props.model.current().draft[props.name]}
      onChange={event => props.model.edit(props.name, event.currentTarget.value)}>
      <For each={props.options}>{option => <option value={option}>{labels[option]}</option>}</For>
    </select>
  </div>;
}

function Toggle(props) {
  const id = "settings-" + props.name;
  return <label class="settings-toggle" for={id}>
    <input id={id} type="checkbox" name={props.name} checked={props.model.current().draft[props.name]}
      onChange={event => props.model.edit(props.name, event.currentTarget.checked)}/>
    <span>{labels[props.name]}</span>
  </label>;
}

function Fields(props) {
  const model = props.model;
  const profile = () => model.current().draft;
  const managed = () => usesManagedDebug(profile());
  const text = (name, options) => <TextField model={model} name={name} {...options}/>;
  const select = (name, label, options) => <SelectField model={model} name={name} label={label} options={options}/>;
  const toggle = name => <Toggle model={model} name={name}/>;
  return <fieldset class="settings-fields" disabled={!profile().enabled} aria-label={labels[model.active()]}>
    <div class="settings-columns">
      <div class="settings-column">
        <Section id="database" icon="storage" title={labels.database} action={
          <Button quiet class="settings-import" disabled={!!model.picker()} title={labels.registeredInfobaseHint} onClick={model.pickInfobase}>
            <Icon name="attributes"/>{labels.registeredInfobase}
          </Button>
        }>
          {select("kind", labels.infobase, ["file", "cluster", "standalone"])}
          <Switch>
            <Match when={profile().kind === "file"}>{text("path")}</Match>
            <Match when={profile().kind === "cluster"}>
              <div class="settings-pair">{text("host", { hint: labels.hostHint })}{text("name")}</div>
            </Match>
            <Match when={profile().kind === "standalone"}>
              {text("url", { url: true })}
              <div class="settings-pair">
                {text("name")}
                {text("admin", { numeric: true })}
              </div>
            </Match>
          </Switch>
        </Section>
        <Section id="authentication" icon="role" title={labels.authentication}>
          {text("user")}{text("secret", { hint: labels.secretHint })}
        </Section>
      </div>
      <div class="settings-column">
        <Section id="platform" icon="configuration" title={labels.platform}>
          <div class="settings-pair">
            {select("runner", labels.runner, ["local", "distrobox"])}{text("version")}
          </div>
          <Show when={profile().runner === "distrobox"}>{text("container")}</Show>
          {text("ibcmd", { hint: labels.ibcmdHint })}
        </Section>
        <Section id="debugging" icon="service" title={labels.debugging}>
          <Show when={profile().kind === "file"}>{toggle("managedDebug")}</Show>
          <Show when={managed()} fallback={text("endpoint", { url: true, hint: labels.endpointHint })}>
            {text("debugPort", { numeric: true })}
          </Show>
          <Show when={managed() || profile().endpoint}>
            {toggle("customAutoAttach")}
            <Show when={profile().customAutoAttach}>{text("autoAttach")}</Show>
            <Show when={externalProcessing || profile().epfArtifact || profile().epfDebugUrl}>
              {text("epfArtifact")}{text("epfDebugUrl")}
            </Show>
          </Show>
        </Section>
      </div>
    </div>
  </fieldset>;
}

function Diagnostics(props) {
  const model = props.model;
  const result = model.result;
  return <section class="settings-diagnostics" aria-label={labels.probe}>
    <div class="settings-check-row">
      <Button disabled={!model.current().draft.enabled || result()?.status === "pending"}
        onClick={() => props.focusError(model.probe())}>
        <Icon name="check"/>{labels.probe}
      </Button>
      <span class="settings-hint">{labels.probeHint}</span>
    </div>
    <div class="settings-result-live" role="status" aria-atomic="true">
      <Show when={result()?.status === "pending"}><span class="settings-visually-hidden">{labels.probing}</span></Show>
      <Show when={result()?.status !== "pending" && result()}>{checked => <div class="settings-result" data-result={checked().status}>
        <Show when={checked().status === "success" || checked().status === "failure"}>
          <strong>{checked().status === "success" ? labels.probeSuccess : labels.probeFailure}</strong>
        </Show>
        <span>{checked().status === "stale" ? labels.probeStale : checked().detail}</span>
      </div>}</Show>
    </div>
  </section>;
}

function Actions(props) {
  const model = props.model;
  const notice = () => model.current().notice;
  const dirty = () => model.dirty(model.active());
  return <footer class="settings-footer">
    <p class="settings-save-status" role="status" data-status={notice()?.kind === "error" ? "error" : dirty() ? "dirty" : "idle"}>
      <Switch fallback={dirty() ? labels.dirty : labels.unchanged}>
        <Match when={model.saving()}>{labels.saving}</Match>
        <Match when={notice()?.kind === "error"}>{notice().detail}</Match>
        <Match when={notice()?.kind === "reloaded" && !dirty()}>{labels.reloaded}</Match>
        <Match when={notice()?.kind === "saved" && !dirty()}><Icon name="check"/>{labels.saved}</Match>
      </Switch>
    </p>
    <div class="settings-actions">
      <Button quiet disabled={!dirty() || !!model.write()} onClick={model.discard}>{labels.discard}</Button>
      <Button primary type="submit" aria-keyshortcuts="Control+S Meta+S" disabled={!model.canSave()}>{labels.save}</Button>
    </div>
  </footer>;
}

function App() {
  const model = settingsController(api);
  let form;
  const receive = event => model.receive(event.data);
  onMount(() => {
    window.addEventListener("message", receive);
    model.load();
  });
  onCleanup(() => window.removeEventListener("message", receive));

  function focusError(field) {
    if (field) form.elements.namedItem(field)?.focus();
  }
  function save(event) {
    event.preventDefault();
    focusError(model.save());
  }

  function keyboardSave(event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") save(event);
  }

  return <article class="settings-page" aria-busy={model.write()?.type === "load"} onKeyDown={keyboardSave}>
    <header class="settings-heading">
      <div>
        <h1>{labels.title}</h1>
        <p>{labels.projectCaption} <code>{project}</code></p>
      </div>
      <Button quiet disabled={!!model.write()} onClick={model.load}>{labels.reload}</Button>
    </header>
    <Show when={model.write()?.type === "load"}><p class="settings-load" role="status">{labels.loading}</p></Show>
    <Show when={model.loadError()}><p class="settings-warning settings-error" role="alert">{model.loadError()}</p></Show>
    <Show when={model.loaded()}>
      <Profiles model={model}/>
      <div class="settings-profile-bar">
        <Toggle model={model} name="enabled"/>
        <span class="settings-context">
          {model.current().draft.enabled ? profileContext(model.current().draft) : labels.disabledProfile}
        </span>
      </div>
      <Show when={model.active() === "prod"}><p class="settings-prod-note">
        <Icon name="storage"/><span>{labels.prodNotice}</span><code>prod</code>
      </p></Show>
      <Show when={model.warning() || model.requiresReload() || model.current().diskChanged}>
        <p class="settings-warning" role="alert">{model.warning() || (model.requiresReload() ? labels.changed : labels.diskChanged)}</p>
      </Show>
      <form ref={form} noValidate onSubmit={save}>
        <Fields model={model}/>
        <Diagnostics model={model} focusError={focusError}/>
        <Actions model={model}/>
      </form>
    </Show>
  </article>;
}

render(App, document.getElementById("root"));
