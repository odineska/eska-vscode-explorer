#!/usr/bin/env python3
"""Attach a VSIX built from the release tag, without replacing existing assets."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
from pathlib import Path

REPOSITORY = "odineska/eska-vscode-explorer"


def run(*args, cwd=None):
    """Pass literal arguments to tools and propagate every build/API failure."""
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def stage_tag(version, destination):
    """Export only the tagged tree, even when main already contains newer changes."""
    tag = f"refs/tags/v{version}"
    manifest = json.loads(run("git", "show", f"{tag}:package.json"))
    if (manifest.get("version"), manifest.get("name"), manifest.get("publisher")) != (
            version, "eska-explorer", "1c-tooling"):
        raise RuntimeError("Release tag and extension identity/version differ")
    archive = destination / "source.tar"
    run("git", "archive", "--format=tar", f"--output={archive}", tag)
    source = destination / "source"
    source.mkdir()
    with tarfile.open(archive) as tree:
        tree.extractall(source, filter="data")
    return source


def existing_asset(version, filename):
    release = json.loads(run("gh", "release", "view", f"v{version}", "--repo", REPOSITORY,
                             "--json", "isDraft,assets"))
    if release["isDraft"]:
        raise RuntimeError("Expected an existing published release")
    return next((asset for asset in release["assets"] if asset["name"] == filename), None)


def confirm_asset(asset, verified_vsix):
    if asset.get("state") != "uploaded" or asset.get("size", 0) <= 0:
        raise RuntimeError("Existing VSIX asset is incomplete; inspect it before retrying")
    if verified_vsix is not None:
        with verified_vsix.open("rb") as contents:
            digest = hashlib.file_digest(contents, "sha256").hexdigest()
        if asset.get("digest") != f"sha256:{digest}":
            raise RuntimeError("Existing VSIX differs from the package verified on this runner")


def publish(version, verified_vsix=None):
    """Build missing assets from the immutable tag; reruns preserve published packages."""
    if not re.fullmatch(r"\d+\.\d+\.\d+", version) or version == "0.0.0":
        raise ValueError("Expected a released three-part version")
    filename = f"eska-explorer-{version}.vsix"
    if verified_vsix is not None:
        tag_tree = run("git", "rev-parse", f"refs/tags/v{version}^{{tree}}")
        if run("git", "rev-parse", "HEAD^{tree}") != tag_tree or run("git", "status", "--porcelain"):
            raise RuntimeError("Verified VSIX must come from the clean release tag tree")
        if verified_vsix.name != filename or not verified_vsix.is_file() or verified_vsix.is_symlink():
            raise RuntimeError("Expected the VSIX verified on this runner")
    existing = existing_asset(version, filename)
    if existing is not None:
        confirm_asset(existing, verified_vsix)
        print(f"Already attached: {filename}")
        return
    if verified_vsix is not None:
        try:
            run("gh", "release", "upload", f"v{version}", str(verified_vsix), "--repo", REPOSITORY)
        except subprocess.CalledProcessError:
            existing = existing_asset(version, filename)
            if existing is None:
                raise
            confirm_asset(existing, verified_vsix)
        print(f"Attached: {filename}")
        return
    with tempfile.TemporaryDirectory(prefix="eska-release-vsix-", dir=os.environ.get("RUNNER_TEMP")) as directory:
        source = stage_tag(version, Path(directory))
        checker = Path(__file__).resolve().with_name("check-vsix.py")
        for args in [("bun", "install", "--frozen-lockfile", "--ignore-scripts"),
                     ("bun", "run", "package"),
                     ("python3", str(checker), filename, "--source", str(source))]:
            run(*args, cwd=source)
        run("gh", "release", "upload", f"v{version}", str(source / filename), "--repo", REPOSITORY)
    print(f"Attached: {filename}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version")
    parser.add_argument("--verified-vsix", type=Path)
    args = parser.parse_args()
    publish(args.version, args.verified_vsix)
