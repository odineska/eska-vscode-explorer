import { deepStrictEqual, strictEqual } from "node:assert";
import { test } from "node:test";
import { changeSetting, manifestEdits, rebaseManifest } from "../webview/settings/project-draft.mjs";

test("clearing an override restores inheritance without leaving an implicit table", () => {
  const baseline = { project: { type: "configuration" } };
  const path = ["format", "bsl", "align_assignments"];
  const draft = changeSetting(baseline, baseline, path, false);
  deepStrictEqual(manifestEdits(baseline, draft), [{ path: ["format"], value: { bsl: { align_assignments: false } } }]);
  deepStrictEqual(manifestEdits(baseline, changeSetting(draft, baseline, path, undefined)), []);
});

test("reloading rebases an independent field and detects an intentionally removed parent", () => {
  const baseline = { format: { profile: "eska", bsl: {} } };
  const path = ["format", "bsl", "align_assignments"];
  const draft = changeSetting(baseline, baseline, path, false);
  const independent = { format: { profile: "1c", bsl: {} } };
  deepStrictEqual(rebaseManifest(baseline, draft, independent), {
    format: { profile: "1c", bsl: { align_assignments: false } },
  });
  strictEqual(rebaseManifest(baseline, draft, { format: { profile: "1c" } }), undefined);
});
