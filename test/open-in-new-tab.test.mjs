import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("new tab action appears only on source rows and preserves existing context menus", () => {
  const menu = manifest.contributes.menus["view/item/context"];
  const action = menu.find(item => item.command === "eska.explorer.openInNewTab");
  const expression = new RegExp(action.when.match(/viewItem =~ \/(.+)\/$/)[1]);
  for (const value of ["eskaMetadataFile", "eskaCommonModuleCreatableFile", "eskaModuleObjectParentFile", "eskaFilesFile", "eskaFormSourceFile"]) assert.ok(expression.test(value), value);
  for (const value of ["eskaRoot", "eskaRootFiltered", "eskaMetadata", "eskaFiles", "eskaForm", "eskaStandardAttribute", "eskaProjectSettings", "eskaQuery"]) assert.equal(expression.test(value), false, value);
  for (const command of ["eska.explorer.properties", "eska.explorer.openXml", "eska.explorer.refreshNode"]) {
    assert.ok(menu.find(item => item.command === command).when.includes("(File)?"), command);
  }
});
