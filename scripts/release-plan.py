#!/usr/bin/env python3
"""Select work for the immutable main commit recorded by the event."""

import json
import subprocess


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def version_commit(version):
    """Find the first commit of the current version along main's first-parent history."""
    introduced = run("git", "rev-parse", "HEAD")
    for commit in run("git", "rev-list", "--first-parent", "HEAD", "--", "package.json").splitlines():
        manifest = json.loads(run("git", "show", f"{commit}:package.json"))
        if manifest["version"] != version:
            break
        introduced = commit
    return introduced


def plan():
    version = run("python3", "scripts/release-version.py")
    if not version:
        return "", ""
    tag = f"refs/tags/v{version}"
    if not run("git", "tag", "--list", f"v{version}"):
        return version, version_commit(version)

    release = json.loads(run("gh", "release", "view", f"v{version}", "--json", "isDraft,assets"))
    if release["isDraft"]:
        raise RuntimeError("Expected an existing published release")
    filename = f"eska-explorer-{version}.vsix"
    existing = next((asset for asset in release["assets"] if asset["name"] == filename), None)
    if existing is None:
        commit = run("git", "rev-parse", f"{tag}^{{commit}}")
        run("git", "merge-base", "--is-ancestor", commit, "HEAD")
        return version, commit
    if existing.get("state") != "uploaded" or existing.get("size", 0) <= 0:
        raise RuntimeError("Existing VSIX asset is incomplete; inspect it before retrying")
    same_tree = run("git", "rev-parse", "HEAD^{tree}") == run("git", "rev-parse", f"{tag}^{{tree}}")
    return (version, "") if same_tree else ("", "")


if __name__ == "__main__":
    version, commit = plan()
    print(f"version={version}")
    print(f"commit={commit}")
    print(f"build={str(bool(commit)).lower()}")
