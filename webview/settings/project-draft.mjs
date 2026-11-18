/** Immutable edits keep snapshots available for preview and conflict handling. */
export function at(value, path) {
  for (const key of path) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return;
    value = value[key];
  }
  return value;
}

const table = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function withValue(value, [key, ...rest], replacement) {
  if (key === undefined) return replacement;
  const next = withValue(at(value, [key]), rest, replacement);
  if (typeof key === "number") {
    const array = Array.isArray(value) ? [...value] : [];
    if (next === undefined) array.splice(key, 1);
    else array[key] = next;
    return array;
  }
  const object = { ...(table(value) ? value : {}), [key]: next };
  if (next === undefined) delete object[key];
  return object;
}

export function changeSetting(draft, baseline, path, replacement) {
  let result = withValue(draft, path, replacement);
  if (replacement !== undefined) return result;
  for (let length = path.length - 1; length > 0; length--) {
    const scope = path.slice(0, length);
    const value = at(result, scope);
    if (!table(value) || Object.keys(value).length || at(baseline, scope) !== undefined) break;
    // Adding a named application or profile is itself an edit, even before it has options.
    if (length === 3 && (scope[0] === "workspace" && scope[1] === "members"
      || scope[0] === "format" && scope[1] === "profiles")) break;
    result = withValue(result, scope, undefined);
  }
  return result;
}

function same(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => same(item, b[i]));
  return table(a) && table(b) && Object.keys(a).length === Object.keys(b).length
    && Object.keys(a).every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}

/** Leave untouched TOML tables, arrays and their comments intact when changing individual fields. */
export function manifestEdits(before, after) {
  const edits = [];
  function diff(a, b, path) {
    if (Object.is(a, b)) return;
    if (table(a) && table(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) diff(at(a, [key]), at(b, [key]), [...path, key]);
    } else if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((item, index) => diff(item, b[index], [...path, index]));
    } else if (Array.isArray(a) && Array.isArray(b) && a.length > b.length) {
      const removed = [];
      let index = 0;
      for (let i = 0; i < a.length; i++) {
        if (index < b.length && same(a[i], b[index])) index++;
        else removed.push(i);
      }
      if (index === b.length && b.length > 0) {
        for (const i of removed.reverse()) edits.push({ path: [...path, i] });
      } else edits.push({ path, value: b });
    } else if (Array.isArray(a) && Array.isArray(b) && a.every((item, i) => same(item, b[i]))) {
      for (let i = a.length; i < b.length; i++) edits.push({ path: [...path, i], value: b[i] });
    } else if (!same(a, b)) {
      edits.push(b === undefined ? { path } : { path, value: b });
    }
  }
  diff(before, after, []);
  return edits;
}

/** On reload, rebase only drafts whose fields have not changed on disk. */
export function rebaseManifest(before, draft, disk) {
  const edits = manifestEdits(before, draft).map(edit => {
    // Array indices refer to the old sequence. Compare the whole array before replaying a change.
    const index = edit.path.findIndex(segment => typeof segment === "number");
    const path = index < 0 ? edit.path : edit.path.slice(0, index);
    return { path, value: at(draft, path) };
  });
  for (const { path, value } of edits) {
    if (!same(at(before, path), at(disk, path)) && !same(value, at(disk, path))) return;
    if (value === undefined) continue;
    for (let length = 1; length < path.length; length++) {
      const scope = path.slice(0, length);
      const parent = at(disk, scope);
      if (!table(parent) && (parent !== undefined || at(before, scope) !== undefined)) return;
    }
  }
  return edits.reduce((value, edit) => withValue(value, edit.path, edit.value), disk);
}
