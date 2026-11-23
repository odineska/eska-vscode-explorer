export const SCM_ROW_HEIGHT = 22;

export function selectRow(selected, anchor, key, visible, { toggle = false, range = false } = {}) {
  const start = visible.indexOf(anchor);
  const end = visible.indexOf(key);
  if (range && start !== -1 && end !== -1) {
    const interval = visible.slice(Math.min(start, end), Math.max(start, end) + 1);
    return { keys: toggle ? [...new Set([...selected, ...interval])] : interval, anchor };
  }
  if (toggle) {
    return { keys: selected.includes(key) ? selected.filter(item => item !== key) : [...selected, key], anchor: key };
  }
  return { keys: [key], anchor: key };
}

export function acknowledgeDraft(draft, repository) {
  if (draft && draft.repositoryToken === repository.repositoryToken && draft.editId > repository.acknowledgedEditId) return draft;
  return { repositoryToken: repository.repositoryToken, value: repository.message, editId: repository.acknowledgedEditId };
}

export function reconcilePendingCommits(pending, repositories) {
  const active = new Map();
  for (const repository of repositories) {
    const commit = pending.get(repository.key);
    if (commit && commit.repositoryToken === repository.repositoryToken && commit.commitId > repository.acknowledgedCommitId) {
      active.set(repository.key, commit);
    }
  }
  return active;
}

export function acknowledgeInput(draft, input) {
  if (!draft || draft.repositoryToken !== input.repositoryToken) return draft;
  if (draft.value === input.message && draft.editId === input.acknowledgedEditId) return draft;
  return acknowledgeDraft(draft, input);
}

export function groupCount(group) {
  return group.count ?? group.rows?.length ?? 0;
}

export function rowWindow(count, top, height, rowHeight = SCM_ROW_HEIGHT, overscan = 8) {
  const start = Math.max(0, Math.min(count, Math.floor(top / rowHeight) - overscan));
  const end = Math.max(start, Math.min(count, Math.ceil((top + height) / rowHeight) + overscan));
  return { start, end };
}

export function positionRange(groups, anchor, target) {
  const a = groups.findIndex(group => group.key === anchor?.group);
  const b = groups.findIndex(group => group.key === target.group);
  if (a < 0 || b < 0) return [{ group: target.group, start: target.index, end: target.index }];
  const forward = a < b || (a === b && anchor.index <= target.index);
  const first = forward ? anchor : target;
  const last = forward ? target : anchor;
  return groups.slice(Math.min(a, b), Math.max(a, b) + 1).map(group => ({
    group: group.key, start: group.key === first.group ? first.index : 0,
    end: group.key === last.group ? last.index : groupCount(group) - 1
  })).filter(range => range.end >= range.start);
}

export function positionSelected(ranges, position) {
  return ranges.some(range => range.group === position.group && range.start <= position.index && range.end >= position.index);
}

export function togglePosition(ranges, position) {
  if (!positionSelected(ranges, position)) return [...ranges, { group: position.group, start: position.index, end: position.index }];
  return ranges.flatMap(range => {
    if (range.group !== position.group || range.start > position.index || range.end < position.index) return [range];
    return [ { ...range, end: position.index - 1 }, { ...range, start: position.index + 1 } ].filter(part => part.start <= part.end);
  });
}
