import test from 'node:test';
import assert from 'node:assert/strict';
import { historyGraph, historyDate } from '../webview/scm-history/model.mjs';
const commit = (id, ...parents) => ({ id, parents });
test('merge parents retain lanes through continuation pages and converge', () => {
  const first = [commit('merge', 'left', 'right'), commit('left', 'base')];
  const rest = [commit('right', 'base'), commit('base')];
  const graph = historyGraph([...first, ...rest]).rows;
  const firstPage = historyGraph(first);
  const nextPage = historyGraph(rest, firstPage.lanes);
  assert.deepEqual([...firstPage.rows, ...nextPage.rows], graph);
  assert.deepEqual(nextPage.lanes, []);
  assert.equal(graph[0].edges.length, 2);
  assert.deepEqual(graph[0].incoming, []);
  assert.deepEqual(graph.slice(0, 2), historyGraph(first).rows);
  assert.equal(graph[2].column, 1);
  assert.equal(graph[2].edges.find(edge => edge.node).to, 0);
  assert.equal(graph[3].edges.length, 0);
});
test('disconnected tips, octopus merges and out-of-range dates remain stable', () => {
  const commits = [commit('a', 'b', 'c', 'd'), commit('other'), commit('b'), commit('c'), commit('d')];
  assert.equal(historyGraph(commits).rows[0].edges.length, 3);
  assert.equal(historyGraph(commits).rows[1].column, 3);
  assert.equal(historyDate(Number.MAX_SAFE_INTEGER).iso, undefined);
  assert.equal(historyDate(0).iso, '1970-01-01T00:00:00.000Z');
});
