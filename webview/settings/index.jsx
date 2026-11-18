import { createEffect, createSignal, For, Match, onSettled, Show, Switch } from "solid-js";
import { render } from "@solidjs/web";
import { Button } from "../ui/controls.jsx";
import { settingsController } from "./controller.js";
import { autoAttachGroups, defaultAutoAttachTypes, profileContext, profiles, usesManagedDebug } from "./profile.mjs";
import { projectController } from "./project-controller.js";
import { ProjectPage, settingsSections } from "./project-page.jsx";

const api = acquireVsCodeApi();
const { labels, project, externalProcessing, title, locale, scope } = JSON.parse(document.getElementById("settings-bootstrap").textContent);

function Icon(props) {
  return <span class="settings-icon" data-icon={props.name} aria-hidden="true"/>;
}

function Profiles(props) {
  const model = props.model;
  return <nav class="settings-profiles" aria-label={labels.profiles}>
    <For each={profiles}>{name => <Button quiet class="settings-profile" data-profile={name}
      aria-pressed={String(model.active() === name)}
      aria-label={[labels[name], name, model.dirty(name) && labels.dirty].filter(Boolean).join(", ")}
      onClick={() => model.select(name)}>
      <Icon name={name === "test" ? "data-processor" : "storage"}/>
      <span>{labels[name]}</span><code class="settings-badge" data-profile={name}>{name}</code>
      <span class={model.dirty(name) ? "settings-dirty-dot is-dirty" : "settings-dirty-dot"} title={model.dirty(name) ? labels.dirty : undefined} aria-hidden="true"/>
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
    <input id={id} name={field} class={field !== "user" ? "eska-code" : ""}
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

function AutoAttachTypes(props) {
  const selection = () => props.model.current().draft;
  const selected = () => selection().customAutoAttach ? selection().autoAttach : defaultAutoAttachTypes;
  const error = () => props.model.fieldError("autoAttach", labels);

  function change(type, checked) {
    const types = selection().autoAttach;
    props.model.edit("autoAttach", checked ? [...types, type] : types.filter(value => value !== type));
  }

  return <fieldset class="settings-auto-attach" aria-describedby="settings-auto-attach-hint">
    <legend class="settings-label">{labels.autoAttach}</legend>
    <Toggle model={props.model} name="customAutoAttach"/>
    <p class="settings-hint" id="settings-auto-attach-hint">
      {selection().customAutoAttach ? labels.autoAttachCustomHint : labels.autoAttachDefaultHint}
    </p>
    <div class="settings-auto-attach-groups">
      <For each={Object.entries(autoAttachGroups)}>{([group, types]) =>
        <fieldset disabled={!selection().customAutoAttach}>
          <legend class="settings-label">{labels[group]}</legend>
          <For each={types}>{type => <label class="settings-toggle">
            <input type="checkbox" name="autoAttach" value={type} checked={selected().includes(type)}
              aria-invalid={error() ? "true" : undefined}
              aria-describedby={error() ? "settings-auto-attach-error" : undefined}
              onChange={event => change(type, event.currentTarget.checked)}/>
            <span>{labels[type]}</span>
          </label>}</For>
        </fieldset>
      }</For>
    </div>
    <Show when={error()}><span class="settings-field-error" id="settings-auto-attach-error">{error()}</span></Show>
  </fieldset>;
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
        <Section id="platform" icon="configuration" title={labels.platform} action={
          <Button quiet class="settings-import" disabled={!!model.picker()} title={labels.installedPlatformHint} onClick={model.pickPlatform}>
            <Icon name="configuration"/>{labels.installedPlatform}
          </Button>
        }>
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
            <AutoAttachTypes model={model}/>
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

function RunSettings(props) {
  const model = props.model;
  let form;

  function focusError(field) {
    if (field === "autoAttach") form.querySelector('input[name="autoAttach"]:enabled')?.focus();
    else if (field) form.elements.namedItem(field)?.focus();
  }
  function save(event) {
    event.preventDefault();
    focusError(model.save());
  }

  function keyboardSave(event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") save(event);
  }

  return <div aria-busy={String(model.write()?.type === "load")} onKeyDown={keyboardSave}>
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
  </div>;
}

function App() {
  const local = settingsController(api);
  const shared = projectController(api);
  const [section, setSection] = createSignal(scope === "workspace" ? "general" : "run");
  const [gitFile, setGitFile] = createSignal(scope === "member" ? "ignore" : "manifest");
  const file = () => section() === "git" ? gitFile() : "manifest";
  const receive = event => {
    if (event.data?.type === "project-file") shared.receive(event.data);
    else local.receive(event.data);
  };
  onSettled(() => {
    window.addEventListener("message", receive);
    if (section() === "run") local.load();
    else shared.ensure(file());
    return () => window.removeEventListener("message", receive);
  });
  createEffect(() => section() === "run" ? null : file(), active => {
    if (active) shared.ensure(active);
  });
  const visible = settingsSections.filter(([id]) =>
    !(scope === "workspace" && id === "run" || scope === "member" && (id === "analyzer" || id === "check")));
  function dirty(id) {
    if (id === "run") return profiles.some(name => local.dirty(name));
    return id === "git" ? ["manifest", "ignore", "attributes"].some(shared.dirty) : shared.dirty("manifest");
  }
  function reload() {
    if (section() === "run") local.load();
    else shared.request(file(), "show");
  }
  return <article class="settings-page">
    <header class="settings-heading">
      <div>
        <h1>{title}</h1>
        <p><code>{project}</code></p>
      </div>
      <Button quiet disabled={section() === "run" ? !!local.write() : !!shared.read(file()).pending} onClick={reload}>{labels.reload}</Button>
    </header>
    <nav class="settings-profiles" aria-label={title}>
      <For each={visible}>{([id, label]) =>
        <Button quiet class="settings-profile" data-settings-section={id} aria-pressed={String(section() === id)}
          onClick={() => setSection(id)}>
          {label[locale]}
          <Show when={dirty(id)}><span class="settings-dirty-dot is-dirty" title={labels.dirty} aria-hidden="true"/></Show>
        </Button>}</For>
    </nav>
    <Show when={section() === "run"} fallback={
      <ProjectPage section={section()} file={file()} openGitFile={setGitFile} member={scope === "member"}
        controller={shared} locale={locale} api={api}/>
    }><RunSettings model={local}/></Show>
  </article>;
}

render(App, document.getElementById("root"));
