import { createEffect, createMemo, createSignal, createStore } from "solid-js";
import { draft, formatErrors, inputField, profiles, serialize } from "./profile.mjs";

const snapshot = value => JSON.stringify(serialize(value));
const sameRequest = (request, data) => request?.id === data.id && request.profile === data.profile;

function recover(value) {
  if (typeof value?.baseline !== "string" || !value.draft) return;
  const fields = draft();
  for (const name of Object.keys(fields)) {
    const saved = value.draft[name];
    if (name === "autoAttach") {
      // Version 1 webview drafts stored a comma-separated string.
      if (typeof saved === "string") {
        if (fields.customAutoAttach) fields.autoAttach = saved.split(",").map(type => type.trim()).filter(Boolean);
      } else if (Array.isArray(saved) && saved.every(type => typeof type === "string")) {
        fields.autoAttach = [...saved];
      } else return;
    } else {
      if (typeof saved !== typeof fields[name]) return;
      fields[name] = saved;
    }
  }
  if (!["file", "cluster", "standalone"].includes(fields.kind) || !["local", "distrobox"].includes(fields.runner)) return;
  return { draft: fields, baseline: value.baseline };
}

/** Separate the acknowledged settings from the mutable form, including while a write is pending. */
export function settingsController(api) {
  const persisted = api.getState();
  const restored = name => persisted?.version === 1 ? recover(persisted.profiles?.[name]) : undefined;
  const initial = name => ({
    saved: draft(), draft: restored(name)?.draft ?? draft(), revision: 0,
    result: null, notice: null, diskChanged: false, visited: {}, validate: false,
  });
  const [state, set] = createStore({ test: initial("test"), prod: initial("prod") });
  const [active, setActive] = createSignal(persisted?.active === "prod" ? "prod" : "test");
  const [loaded, setLoaded] = createSignal(false);
  const [write, setWrite] = createSignal(null);
  const [warning, setWarning] = createSignal("");
  const [loadError, setLoadError] = createSignal("");
  const [requiresReload, setRequiresReload] = createSignal(false);
  const [picker, setPicker] = createSignal(null);
  const current = () => state[active()];
  const dirty = Object.fromEntries(profiles.map(name => [name, createMemo(
    () => snapshot(state[name].draft) !== snapshot(state[name].saved),
  )]));
  const errors = createMemo(() => formatErrors(current().draft));
  const canSave = () => loaded() && !write() && !warning() && !requiresReload() && dirty[active()]();
  const saving = () => write()?.type === "save" && write().profile === active();
  const result = () => {
    const checked = current().result;
    return checked && (checked.revision === current().revision ? checked : { status: "stale" });
  };
  const newRequest = type => ({ type, id: crypto.randomUUID(), profile: active() });

  createEffect(() => {
    if (!loaded()) return;
    const drafts = {};
    for (const name of profiles) if (dirty[name]()) {
      drafts[name] = { draft: { ...state[name].draft, autoAttach: [...state[name].draft.autoAttach] }, baseline: snapshot(state[name].saved) };
    }
    return { version: 1, active: active(), profiles: drafts };
  }, value => { if (value) api.setState(value); });

  function cancelPick() {
    const pending = picker();
    if (!pending) return;
    setPicker(null);
    api.postMessage({ ...pending, type: "cancelPick" });
  }

  function select(name) {
    if (name !== active()) {
      cancelPick();
      setActive(name);
    }
  }

  function editFields(name, fields) {
    if (!Object.keys(fields).some(field => state[name].draft[field] !== fields[field])) return;
    set(profiles => {
      const profile = profiles[name];
      Object.assign(profile.draft, fields);
      profile.revision++;
      profile.notice = null;
      if (snapshot(profile.draft) === snapshot(profile.saved)) profile.diskChanged = false;
    });
  }

  function edit(field, value) {
    if (field === "enabled" && !value) cancelPick();
    editFields(active(), { [field]: value });
  }

  function discard() {
    const name = active();
    if (!dirty[name]() || write()) return;
    cancelPick();
    editFields(name, { ...state[name].saved });
    set(profiles => {
      Object.assign(profiles[name], { validate: false, notice: null, diskChanged: false, visited: {} });
    });
  }

  function load() {
    if (write()) return;
    const request = newRequest("load");
    setWrite(request);
    setLoadError("");
    api.postMessage(request);
  }

  function firstInvalidField() {
    const field = Object.keys(errors())[0];
    if (field) set(profiles => { profiles[active()].validate = true; });
    return field;
  }

  function save() {
    if (!canSave()) return;
    const field = firstInvalidField();
    if (field) return field;
    const request = newRequest("save");
    set(profiles => { profiles[request.profile].notice = null; });
    setWrite({ ...request, revision: current().revision });
    api.postMessage({ ...request, value: serialize(current().draft) });
  }

  function probe() {
    if (!loaded() || !current().draft.enabled || result()?.status === "pending") return;
    const field = firstInvalidField();
    if (field) return field;
    const request = newRequest("probe");
    set(profiles => {
      const profile = profiles[request.profile];
      profile.result = { id: request.id, revision: profile.revision, status: "pending" };
    });
    api.postMessage({ ...request, value: serialize(current().draft) });
  }

  function pickInfobase() {
    if (!loaded() || !current().draft.enabled || picker()) return;
    const request = newRequest("pickInfobase");
    setPicker(request);
    set(profiles => { profiles[request.profile].notice = null; });
    api.postMessage(request);
  }

  function acceptSettings(data, pending) {
    const wasLoaded = loaded();
    set(byProfile => {
      for (const name of profiles) {
        const next = draft(data.settings[name]);
        const profile = byProfile[name];
        const recovering = wasLoaded ? undefined : restored(name);
        const previous = recovering?.baseline ?? snapshot(profile.saved);
        const keep = pending.type === "save"
          ? name !== pending.profile || profile.revision !== pending.revision
          : !!recovering || wasLoaded && snapshot(profile.draft) !== previous;
        const nextSnapshot = snapshot(next);
        const changedOnDisk = pending.type === "load" && keep && previous !== nextSnapshot;
        profile.saved = next;
        if (!keep) {
          if (snapshot(profile.draft) !== nextSnapshot) profile.revision++;
          profile.draft = { ...next };
        }
        if (pending.type === "load") {
          profile.notice = null;
          profile.diskChanged = snapshot(profile.draft) !== nextSnapshot && (profile.diskChanged || changedOnDisk);
        }
      }
      const profile = byProfile[pending.profile];
      if (pending.type === "save") {
        profile.notice = { kind: "saved" };
        profile.diskChanged = false;
      } else if (wasLoaded) {
        profile.notice = { kind: "reloaded" };
      }
    });
    setWarning(data.warning ?? "");
    setRequiresReload(false);
    setLoaded(true);
  }

  function receive(data) {
    if (!data || !profiles.includes(data.profile)) return;
    const { profile, id } = data;
    if (data.type === "probe") {
      const checked = state[profile].result;
      if (checked?.id !== id || checked.status !== "pending" || checked.revision !== state[profile].revision) return;
      set(profiles => {
        profiles[profile].result = {
          id, revision: checked.revision, status: data.ready ? "success" : "failure",
          detail: data.detail, field: inputField(data.field),
        };
      });
    } else if (data.type === "infobase") {
      if (!sameRequest(picker(), data)) return;
      setPicker(null);
      if (profile !== active() || !current().draft.enabled) return;
      const base = data.infobase;
      if (base) editFields(profile, {
        kind: base.kind, path: base.path ?? "", host: base.host ?? "", name: base.name ?? "", url: "", admin: "",
      });
      else if (data.detail) set(profiles => { profiles[profile].notice = { kind: "error", detail: data.detail }; });
    } else if (data.type === "settings" || data.type === "error") {
      const pending = write();
      if (!sameRequest(pending, data) || pending.type !== data.operation) return;
      if (data.type === "settings") acceptSettings(data, pending);
      else if (pending.type === "load") setLoadError(data.detail);
      else {
        set(profiles => {
          const next = profiles[profile];
          next.notice = { kind: "error", detail: data.detail,
            field: next.revision === pending.revision ? inputField(data.field) : undefined };
        });
        setRequiresReload(data.requiresReload === true);
      }
      setWrite(null);
    }
  }

  function fieldError(field, labels) {
    const { visited, validate, notice } = current();
    if (errors()[field] && (validate || visited[field])) return labels[errors()[field]];
    if (notice?.field === field) return labels.invalidField;
    const checked = result();
    return checked?.field === field ? labels.invalidField : undefined;
  }

  return {
    active, current, loaded, write, warning, loadError, requiresReload, picker, result, saving, canSave,
    dirty: name => dirty[name](),
    select, edit, discard, load, save, probe, pickInfobase, receive, fieldError,
    visit: field => set(profiles => { profiles[active()].visited[field] = true; }),
  };
}
