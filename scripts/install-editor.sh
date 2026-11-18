#!/usr/bin/env bash
# Use one verified VS Code build for native language checks in an isolated profile.
set -euo pipefail
editor_root="${RUNNER_TEMP:?}/eska-test-editor"
archive="$editor_root/editor.tar.gz"
read -r sha256 < "$(dirname -- "${BASH_SOURCE[0]}")/test-editor.sha256"
mkdir -p "$editor_root"

verify_archive() {
  printf '%s  %s\n' "$sha256" "$1" | sha256sum --check --status
}

started=$SECONDS
if [[ -f "$archive" && ! -L "$archive" ]] && verify_archive "$archive"; then
  printf 'Verified cached VS Code archive in %ss.\n' "$((SECONDS - started))"
else
  download=$(mktemp "$editor_root/download.XXXXXXXX")
  trap 'rm -f -- "$download"' EXIT
  curl --fail --silent --show-error --location --retry 3 \
    'https://vscode.download.prss.microsoft.com/dbazure/download/stable/2d0b7506a36c1d6db9a466440131a8e01eab2289/code-stable-x64-1792533330.tar.gz' \
    --output "$download"
  if ! verify_archive "$download"; then
    printf 'VS Code archive checksum mismatch.\n' >&2
    exit 1
  fi
  mv -fT -- "$download" "$archive"
  printf 'Downloaded and verified the VS Code archive in %ss.\n' "$((SECONDS - started))"
fi

started=$SECONDS
tar -xzf "$archive" -C "$editor_root"
printf 'Extracted the VS Code archive in %ss.\n' "$((SECONDS - started))"
# Archive extraction does not configure the root-owned SUID helper required on the CI runner.
sudo chown root:root "$editor_root/VSCode-linux-x64/chrome-sandbox"
sudo chmod 4755 "$editor_root/VSCode-linux-x64/chrome-sandbox"
printf 'VSCODE_EXECUTABLE=%s\n' "$editor_root/VSCode-linux-x64/bin/code" >> "${GITHUB_ENV:?}"
