import assert from "node:assert/strict";
import { test } from "node:test";
import { appendGitRules, gitRules, missingGitDefaults, updateGitRule, validGitPattern } from "../webview/settings/git-rules.mjs";

test("gitignore editing retains order, comments, escaped patterns, CRLF and no final newline", () => {
  const text = "\uFEFF# local\r\n/build/\r\n!/build/keep.txt\r\n\r\n\\#manual\\ \r\nlast";
  const rules = gitRules("ignore", text);
  assert.deepEqual(rules.map(rule => rule.pattern), ["/build/", "!/build/keep.txt", "\\#manual\\ ", "last"]);
  const updated = updateGitRule("ignore", text, rules[1].index, "!/build/keep/**");
  const removed = updateGitRule("ignore", updated, rules[3].index, null);
  assert.equal(removed, "\uFEFF# local\r\n/build/\r\n!/build/keep/**\r\n\r\n\\#manual\\ \r\n");
  assert.equal(appendGitRules("ignore", text, [".eska/"]), text + "\r\n.eska/");
  assert.equal(updateGitRule("ignore", text, 1, "# not a rule"), text);
  assert.deepEqual(missingGitDefaults("ignore", "!/build/\n.eska/\n", ["/build/", ".eska/", "*.tmp"]), ["*.tmp"]);
});

test("LFS edits recognize quoted patterns and leave attributes on their original paths", () => {
  const text = '# custom\r\n* text=auto eol=lf\r\n  "my files/\\\"backup\\\"/*.epf"\tcustom=on filter=lfs diff=lfs merge=lfs -text linguist-generated\r\n[attr]lfs filter=lfs\r\n*.png filter=lfs -diff';
  const rules = gitRules("attributes", text);
  assert.deepEqual(rules, [
    { index: 2, pattern: '"my files/\\\"backup\\\"/*.epf"', shared: true },
    { index: 4, pattern: "*.png", shared: true },
  ]);
  const edited = updateGitRule("attributes", text, 2, '"new files/*.epf"');
  assert.equal(edited, '# custom\r\n* text=auto eol=lf\r\n  "my files/\\\"backup\\\"/*.epf"\tcustom=on linguist-generated\r\n  "new files/*.epf" filter=lfs diff=lfs merge=lfs -text\r\n[attr]lfs filter=lfs\r\n*.png filter=lfs -diff');
  assert.equal(updateGitRule("attributes", text, 4, null), text.replace("*.png filter=lfs -diff", "*.png -diff"));
  assert.equal(validGitPattern("attributes", "two names/*.epf"), false);
  assert.equal(appendGitRules("attributes", text, ["*.zip"]), text + "\r\n*.zip filter=lfs diff=lfs merge=lfs -text");
});

test("LFS defaults avoid overriding an existing filter and preserve unrelated rules", () => {
  const text = '*.zip filter=custom\n"*.bin" filter=lfs\n*.epf text\n*.png filter=lfs -filter\n';
  assert.deepEqual(gitRules("attributes", text).map(rule => rule.pattern), ['"*.bin"']);
  assert.deepEqual(missingGitDefaults("attributes", text, ["*.zip", "*.bin", "*.epf", "*.png"]), ["*.epf"]);
});
