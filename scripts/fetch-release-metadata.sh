#!/usr/bin/env bash
set -euo pipefail

metadata_dir="$(mktemp -d "${RUNNER_TEMP:?}/eska-backend-releases.XXXXXXXX")"
for repository in odineska/eska itrous/bsl-analyzer; do
  gh api --hostname github.com "repos/$repository/releases/latest" > "$metadata_dir/${repository##*/}.json"
done
printf 'ESKA_TEST_RELEASE_METADATA=%s\n' "$metadata_dir" >> "${GITHUB_ENV:?}"
