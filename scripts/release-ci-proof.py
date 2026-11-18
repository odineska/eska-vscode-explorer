#!/usr/bin/env python3
"""Reuse the full CI of the exact application tree when release inputs also match."""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from importlib import import_module
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile

REPOSITORY = "odineska/eska-vscode-explorer"
ARTIFACT = "explorer-full-ci"
WORKFLOW = ".github/workflows/ci.yml"


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def api(path):
    return json.loads(output("gh", "api", f"repos/{REPOSITORY}/{path}"))


def evidence(inputs):
    return {
        "schema": 1,
        "tree": output("git", "rev-parse", "HEAD^{tree}"),
        "node": output("node", "--version"),
        "bun": output("bun", "--version"),
        "inputs": json.loads(inputs.read_text()),
    }


def read_artifact(run):
    name = f"{ARTIFACT}-{run['run_attempt']}"
    records = api(f"actions/runs/{run['id']}/artifacts?name={name}")["artifacts"]
    if len(records) != 1:
        return None
    artifact = records[0]
    if artifact["expired"] or artifact["name"] != name or artifact["size_in_bytes"] > 65536:
        return None
    archive = subprocess.check_output(("gh", "api", f"repos/{REPOSITORY}/actions/artifacts/{artifact['id']}/zip"))
    if artifact.get("digest") != f"sha256:{hashlib.sha256(archive).hexdigest()}":
        return None
    with ZipFile(BytesIO(archive)) as package:
        if package.namelist() != ["proof.json"] or package.getinfo("proof.json").file_size > 16384:
            return None
        return json.loads(package.read("proof.json"))


def baseline_passed(inputs, version):
    baseline = output("git", "rev-parse", "HEAD^1")
    if not import_module("release-pr-check").release_only_tree(baseline, "HEAD", version):
        return False
    expected = evidence(inputs)
    expected["tree"] = output("git", "rev-parse", f"{baseline}^{{tree}}")
    workflow = api("actions/workflows/ci.yml")
    if workflow["path"] != WORKFLOW:
        return False

    pulls = api(f"commits/{baseline}/pulls")
    for pull in pulls:
        if (pull["merge_commit_sha"] != baseline or not pull["merged_at"] or pull["base"]["ref"] != "main"
                or pull["base"]["repo"]["full_name"] != REPOSITORY
                or not pull["head"]["repo"] or pull["head"]["repo"]["full_name"] != REPOSITORY):
            continue
        head = pull["head"]["sha"]
        if not re.fullmatch(r"[0-9a-f]{40}", head):
            continue
        runs = api(f"actions/workflows/ci.yml/runs?event=pull_request&status=success&head_sha={head}")["workflow_runs"]
        for run in runs:
            if (run["workflow_id"] != workflow["id"] or run["path"] != WORKFLOW or run["event"] != "pull_request"
                    or run["conclusion"] != "success" or run["head_sha"] != head
                    or run["repository"]["full_name"] != REPOSITORY
                    or not run["head_repository"] or run["head_repository"]["full_name"] != REPOSITORY
                    or run["created_at"] > pull["merged_at"]
                    or any(pr["number"] != pull["number"] for pr in run["pull_requests"])):
                continue
            jobs = api(f"actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs")["jobs"]
            checks = [job for job in jobs if job["name"] == "check" and job["conclusion"] == "success"]
            required_steps = {
                "Check and compile",
                "Test the client and install the test editor",
                "Check the packaged extension with real Metadata API and LSP",
                "Record the tested tree and release inputs",
            }
            if len(checks) != 1 or not required_steps <= {
                step["name"] for step in checks[0]["steps"] if step["conclusion"] == "success"
            }:
                continue
            if read_artifact(run) == expected | {"pull": pull["number"]}:
                print(f"Full application CI verified by workflow run {run['id']}", file=sys.stderr)
                return True
    return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--record", type=Path)
    mode.add_argument("--baseline", metavar="VERSION")
    parser.add_argument("--pull", type=int)
    args = parser.parse_args()
    if args.record:
        if not args.pull:
            parser.error("--record requires --pull")
        args.record.write_text(json.dumps(evidence(args.inputs) | {"pull": args.pull}) + "\n")
    else:
        try:
            reuse = baseline_passed(args.inputs, args.baseline)
        except (BadZipFile, ImportError, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError):
            reuse = False
        print(f"verified_baseline={str(reuse).lower()}")
