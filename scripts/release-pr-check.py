#!/usr/bin/env python3
"""Recognize a version-only PR created by this repository's release automation."""

import json
import os
import re
import subprocess


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def generated_release_pr():
    repository = os.environ["GITHUB_REPOSITORY"]
    branch = os.environ["RELEASE_HEAD_REF"]
    match = re.fullmatch(r"release/eska-explorer-(\d+\.\d+\.\d+)-([0-9a-f]{12})-([0-9a-f]{8})", branch)
    if repository != "odineska/eska-vscode-explorer" or not match:
        return False
    version, base_prefix, tree_prefix = match.groups()
    prs = json.loads(run("gh", "pr", "list", "--repo", repository, "--state", "open", "--base", "main",
                         "--head", branch, "--json", "author,headRefOid,headRepositoryOwner,isCrossRepository"))
    if len(prs) != 1:
        return False
    pr = prs[0]
    if (pr["isCrossRepository"] or pr["headRepositoryOwner"]["login"] != repository.split("/")[0]
            or pr["author"]["is_bot"] is not True or pr["author"]["login"] != "app/github-actions"):
        return False
    head = pr["headRefOid"]
    event = os.environ["GITHUB_EVENT_NAME"]
    if event == "pull_request":
        if head != run("git", "rev-parse", "HEAD^2"):
            return False
        base = run("git", "rev-parse", "HEAD^1")
    elif event == "workflow_dispatch" and head == run("git", "rev-parse", "HEAD"):
        base = run("git", "rev-parse", "HEAD^1")
    else:
        return False
    if not base.startswith(base_prefix) or not run("git", "rev-parse", f"{head}^{{tree}}").startswith(tree_prefix):
        return False
    if run("git", "rev-list", "--parents", "-1", head).split() != [head, base]:
        return False
    target = run("git", "rev-parse", "HEAD^{tree}")
    if target != run("git", "rev-parse", f"{head}^{{tree}}"):
        return False
    return release_only_tree(base, "HEAD", version)


def release_only_tree(base, head, version):
    """Require unchanged application and tooling plus exactly one new changelog section."""
    if set(run("git", "diff", "--name-only", base, head).splitlines()) != {"package.json", "CHANGELOG.md"}:
        return False

    package = json.loads(run("git", "show", f"{base}:package.json"))
    previous_version = package["version"]
    if previous_version == version:
        return False
    package["version"] = version
    if json.loads(run("git", "show", f"{head}:package.json")) != package:
        return False
    old_changelog = run("git", "show", f"{base}:CHANGELOG.md")
    changelog = run("git", "show", f"{head}:CHANGELOG.md")
    heading = re.search(rf"^## {re.escape(version)} \(\d{{4}}-\d{{2}}-\d{{2}}\)\n", changelog, re.MULTILINE)
    if heading is None:
        return False
    next_heading = re.search(r"^## ", changelog[heading.end():], re.MULTILINE)
    end = heading.end() + next_heading.start() if next_heading else len(changelog)
    # Knope prepends a section. Existing notes, title and introduction must survive verbatim.
    return (changelog[:heading.start()] + changelog[end:]).rstrip() == old_changelog.rstrip()


if __name__ == "__main__":
    try:
        metadata_only = generated_release_pr()
    except (KeyError, ValueError, subprocess.CalledProcessError):
        metadata_only = False
    print(f"metadata_only={str(metadata_only).lower()}")
