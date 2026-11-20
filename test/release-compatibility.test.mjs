import assert from "node:assert/strict";
import test from "node:test";
import { verifyReviewedBackends } from "../scripts/release-compatibility.mjs";

const reviewed = { "odineska/eska": "v1.0.0", "itrous/bsl-analyzer": "v0.4.6" };

test("the release accepts the same pair on the next Explorer version", () => {
  assert.doesNotThrow(() => verifyReviewedBackends(reviewed, "1.0.0", "0.4.6"));
});

test("a changed backend requires a review of its own tag range", () => {
  const project = "https://github.com/odineska/eska/compare/v1.0.0...v1.1.0";
  const analyzer = "https://github.com/itrous/bsl-analyzer/compare/v0.4.6...v0.4.7";
  for (const [projectVersion, analyzerVersion, ranges] of [
    ["1.1.0", "0.4.6", [project]], ["1.0.0", "0.4.7", [analyzer]], ["1.1.0", "0.4.7", [project, analyzer]],
  ]) {
    assert.throws(() => verifyReviewedBackends(reviewed, projectVersion, analyzerVersion), error => {
      assert.deepEqual(error.message.split("\n").slice(1), ranges);
      return true;
    });
  }
  assert.throws(() => verifyReviewedBackends({}, "1.0.0", "0.4.6"), /odineska\/eska/);
});
