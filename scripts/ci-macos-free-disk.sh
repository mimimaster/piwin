#!/usr/bin/env bash
# GitHub-hosted macOS images ship several Xcode copies. All-in-one packaging
# needs ~8+ GB free (pnpm tree + dist-host + cargo + DMG). Extra Xcodes go first.
set -euo pipefail

echo "[ci-macos-free-disk] before:"
df -h /

selected="$(xcode-select -p 2>/dev/null || true)"
echo "[ci-macos-free-disk] xcode-select: ${selected:-none}"

for app in /Applications/Xcode_*.app; do
  if [[ ! -d "${app}" ]]; then
    continue
  fi
  if [[ -n "${selected}" && "${selected}" == "${app}"* ]]; then
    echo "[ci-macos-free-disk] keep ${app}"
    continue
  fi
  echo "[ci-macos-free-disk] remove ${app}"
  sudo rm -rf "${app}"
done

sudo rm -rf "${HOME}/Library/Developer/CoreSimulator/Caches" || true

echo "[ci-macos-free-disk] after:"
df -h /
