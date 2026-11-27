/** Continue a snapshot page using only its unresolved parent lanes. */
export function historyGraph(commits, pending = []) {
  const lanes = [...pending];
  const rows = commits.map(commit => {
    const incoming = lanes.map((_, lane) => lane);
    let column = lanes.indexOf(commit.id);
    if (column < 0) { column = lanes.length; lanes.push(commit.id); }
    const before = [...lanes];
    const parents = [...new Set(commit.parents)];
    lanes.splice(column, 1);
    for (const [offset, parent] of parents.entries()) {
      if (!lanes.includes(parent)) lanes.splice(Math.min(column + offset, lanes.length), 0, parent);
    }
    const edges = [];
    before.forEach((id, from) => {
      if (id !== commit.id) edges.push({ from, to: lanes.indexOf(id), node: false });
    });
    parents.forEach(id => edges.push({ from: column, to: lanes.indexOf(id), node: true, parent: id }));
    return { commit, column, edges, incoming, width: Math.max(before.length, lanes.length, 1) };
  });
  return { rows, lanes };
}
/** Git timestamps may exceed the JavaScript Date range. */
export function historyDate(seconds) {
  const value = new Date(seconds * 1000);
  return Number.isFinite(value.getTime()) ? { text: value.toLocaleString(), iso: value.toISOString() } : { text: String(seconds), iso: undefined };
}
