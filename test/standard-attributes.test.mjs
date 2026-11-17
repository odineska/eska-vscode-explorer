import { test } from "node:test";
import assert from "node:assert/strict";
import { isNodeId, nodeKey, parseNode } from "../out/tree.js";
import { iconName } from "../out/icons.js";
import { resolveSource, resolveTreeSource } from "../out/source.js";

test("standard attribute identities are owner-scoped virtual leaves with existing artwork", async () => {
  const parent = { kind: "collection", owner: "catalog:Goods", collection: { kind: "standardAttributes" } };
  const id = { kind: "standardAttribute", owner: parent.owner, name: "Code" };
  const node = parseNode({ id, parent, metadataKind: null, label: { kind: "key", key: "platform-value-StandardAttribute-Code", translations: { "ru-RU": "Код", "en-US": "Code" } }, state: "empty", expandedByDefault: false, rootSection: false });
  assert.equal(isNodeId(id), true);
  assert.equal(isNodeId(parent), true);
  assert.equal(isNodeId({ ...id, name: "" }), false);
  assert.equal(isNodeId({ ...id, name: 0 }), false);
  assert.notEqual(nodeKey(id), nodeKey({ ...id, owner: "catalog:Other" }));
  assert.notEqual(nodeKey(id), nodeKey({ kind: "object", objectId: "catalog:Goods/attribute:Code" }));
  assert.equal(iconName(node), "attribute");
  assert.equal(iconName({ ...node, id: parent }), "attributes");
  const tree = { request() { throw Error("virtual field must not request sources"); } };
  const entry = { node };
  assert.equal(await resolveTreeSource(tree, entry), undefined);
  await assert.rejects(resolveSource(tree, entry), error => error.code === "sourceMissing");
});
