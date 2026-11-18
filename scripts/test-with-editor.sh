#!/usr/bin/env bash
# Overlap independent client tests and editor setup before running the VSIX in the editor.
set -euo pipefail

(
  bun test
  if [[ "${1:-}" == --release ]]; then
    knope --validate
  fi
  KNOPE_TEST_BINARY="$(command -v knope)" \
    python3 -m unittest discover -s test -p '*_test.py'
) &
tests_pid=$!

(
  # Hosted runners already provide these packages. Install them if the image changes.
  if ! command -v xvfb-run >/dev/null || ! command -v Xvfb >/dev/null ||
     ! command -v xauth >/dev/null ||
     [[ "$(dpkg-query -W -f='${db:Status-Status}' libasound2t64 2>/dev/null)" != installed ]]; then
    sudo apt-get update
    sudo apt-get install -y xvfb xauth libasound2t64
  fi
  bash scripts/install-editor.sh
) &
editor_pid=$!

status=0
wait "$tests_pid" || status=$?
wait "$editor_pid" || status=$?
exit "$status"
