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
