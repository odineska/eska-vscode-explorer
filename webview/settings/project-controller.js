import { createSignal } from "solid-js";
import { changeSetting, manifestEdits, rebaseManifest } from "./project-draft.mjs";

/** All shared sections editing eska.toml use the same draft and acknowledged revision. */
export function projectController(api) {
  function initial() {
    return { pending: null, snapshot: undefined, draft: undefined, preview: null, error: null,
      conflict: false, conflictBase: undefined, saved: false };
  }
  const [files, setFiles] = createSignal({ manifest: initial(), ignore: initial(), attributes: initial() });
  const read = file => files()[file];
  function update(file, attributes) {
    setFiles(files => ({ ...files, [file]: { ...files[file], ...attributes } }));
  }
  const changes = file => read(file).snapshot && (file === "manifest"
    ? manifestEdits(read(file).snapshot.value, read(file).draft)
    : read(file).snapshot.value !== read(file).draft);
  const dirty = file => !!(file === "manifest" ? changes(file)?.length : changes(file));

  function request(file, operation) {
    const current = read(file);
    if (current.pending || (operation !== "show" && (!dirty(file) || current.conflict))) return;
    const pending = { type: "project-file", id: crypto.randomUUID(), file, operation };
    update(file, { pending, error: null, preview: null, saved: false });
    if (operation === "show") api.postMessage(pending);
    else api.postMessage({
      ...pending,
      revision: current.snapshot.revision,
      ...(file === "manifest" ? { edits: changes(file) } : { value: current.draft }),
    });
  }

  function edit(file, value) {
    if (read(file).pending || read(file).conflict) return;
    update(file, { draft: value, error: null, preview: null, analyzer: null, saved: false });
  }

  function receive(data) {
    if (data?.type !== "project-file" || !Object.hasOwn(files(), data.file)) return;
    const file = data.file;
    const current = read(file);
    const pending = current.pending;
    if (!pending || pending.id !== data.id || pending.operation !== data.operation) return;
    if (data.error) {
      update(file, { pending: null, error: data.error, conflict: current.conflict || data.error.code === "settings_changed" });
      return;
    }
    if (data.operation === "preview") {
      update(file, { pending: null, preview: { before: data.before, after: data.after } });
      return;
    }
    const snapshot = { revision: data.revision, value: data.value, metadata: data.metadata ?? current.snapshot?.metadata };
    let draft = snapshot.value;
    let conflict = false;
    const baseline = current.conflictBase ?? current.snapshot;
    if (data.operation === "show" && baseline && (dirty(file) || current.conflictBase)) {
      const rebased = file === "manifest"
        ? rebaseManifest(baseline.value, current.draft, snapshot.value)
        : baseline.revision === snapshot.revision || current.draft === snapshot.value ? current.draft : undefined;
      draft = rebased ?? current.draft;
      conflict = rebased === undefined;
    }
    update(file, {
      pending: null, snapshot, draft, conflict, conflictBase: conflict ? baseline : undefined, saved: data.operation === "save",
      analyzer: data.analyzer ?? null,
    });
  }

  return {
    read, dirty, receive, request, edit,
    ensure(file) {
      if (!read(file).snapshot && !read(file).error) request(file, "show");
    },
    set(path, value) {
      const { draft, snapshot } = read("manifest");
      edit("manifest", changeSetting(draft, snapshot?.value, path, value));
    },
    discard(file) {
      update(file, { draft: read(file).snapshot?.value, preview: null, error: null, conflict: false,
        conflictBase: undefined, analyzer: null, saved: false });
    },
  };
}
