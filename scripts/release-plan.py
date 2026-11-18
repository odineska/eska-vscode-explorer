#!/usr/bin/env python3
"""Select work for the immutable main commit recorded by the event."""

import json
import subprocess


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def plan():
    version = run("python3", "scripts/release-version.py")
    if not version:
        return "", False
    tag = f"refs/tags/v{version}"
    if not run("git", "tag", "--list", f"v{version}"):
        parents = run("git", "rev-list", "--parents", "-n", "1", "HEAD").split()
        if len(parents) > 1:
            previous = json.loads(run("git", "show", "HEAD^1:package.json"))["version"]
            if previous == version:
                raise RuntimeError(f"Retry the main workflow at the commit introducing v{version}")
        return version, True

    release = json.loads(run("gh", "release", "view", f"v{version}", "--json", "isDraft,assets"))
    if release["isDraft"]:
        raise RuntimeError("Expected an existing published release")
    filename = f"eska-explorer-{version}.vsix"
    existing = next((asset for asset in release["assets"] if asset["name"] == filename), None)
    same_tree = run("git", "rev-parse", "HEAD^{tree}") == run("git", "rev-parse", f"{tag}^{{tree}}")
    if existing is None:
        if not same_tree:
            raise RuntimeError(f"Retry the workflow at the commit tagged v{version} to finish attaching the VSIX")
        return version, True
    if existing.get("state") != "uploaded" or existing.get("size", 0) <= 0:
        raise RuntimeError("Existing VSIX asset is incomplete; inspect it before retrying")
    return (version, False) if same_tree else ("", False)


if __name__ == "__main__":
    version, build = plan()
    print(f"version={version}")
    print(f"build={str(build).lower()}")
