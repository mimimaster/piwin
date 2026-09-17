#!/usr/bin/env bash
# Submit a Developer-ID-signed DMG to Apple notary, wait, then staple.
# Does not rebuild. Skip when APPLE_API_KEY is unset (CI without secrets).
#
# Env:
#   APPLE_API_KEY          App Store Connect Key ID (e.g. FZCXKK6D92)
#   APPLE_API_ISSUER       Issuer UUID
#   APPLE_API_KEY_PATH     path to AuthKey_<id>.p8 (optional)
#   APPLE_API_KEY_P8       PEM contents; written to a temp file when PATH is missing
#
# Usage:
#   bash scripts/notarize-macos-dmg.sh [path.dmg]
set -euo pipefail

if [[ -z "${APPLE_API_KEY:-}" ]]; then
  echo "[notarize-macos-dmg] skip: APPLE_API_KEY unset"
  exit 0
fi
if [[ -z "${APPLE_API_ISSUER:-}" ]]; then
  echo "[notarize-macos-dmg] APPLE_API_ISSUER is required when APPLE_API_KEY is set" >&2
  exit 1
fi

cleanup_key=""
cleanup() {
  if [[ -n "${cleanup_key}" && -f "${cleanup_key}" ]]; then
    rm -f "${cleanup_key}"
  fi
}
trap cleanup EXIT

resolve_key_path() {
  if [[ -n "${APPLE_API_KEY_PATH:-}" ]]; then
    printf '%s' "${APPLE_API_KEY_PATH}"
    return
  fi
  local home_key="${HOME}/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY}.p8"
  if [[ -f "${home_key}" ]]; then
    printf '%s' "${home_key}"
    return
  fi
  if [[ -n "${APPLE_API_KEY_P8:-}" ]]; then
    local temp_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
    mkdir -p "${temp_dir}"
    cleanup_key="${temp_dir%/}/AuthKey_${APPLE_API_KEY}.p8"
    printf '%s' "${APPLE_API_KEY_P8}" > "${cleanup_key}"
    chmod 600 "${cleanup_key}"
    printf '%s' "${cleanup_key}"
    return
  fi
  echo "[notarize-macos-dmg] missing AuthKey_${APPLE_API_KEY}.p8 (set APPLE_API_KEY_PATH or APPLE_API_KEY_P8)" >&2
  exit 1
}

resolve_dmg() {
  if [[ -n "${1:-}" ]]; then
    printf '%s' "$1"
    return
  fi
  local bundle_root="apps/desktop/src-tauri/target/release/bundle/dmg"
  if [[ -n "${CARGO_TARGET_DIR:-}" ]]; then
    bundle_root="${CARGO_TARGET_DIR%/}/release/bundle/dmg"
  fi
  shopt -s nullglob
  local dmgs=("${bundle_root}"/*.dmg)
  if [[ "${#dmgs[@]}" -eq 0 ]]; then
    echo "[notarize-macos-dmg] no .dmg in ${bundle_root}" >&2
    exit 1
  fi
  printf '%s' "${dmgs[0]}"
}

KEY_PATH="$(resolve_key_path)"
DMG_PATH="$(resolve_dmg "${1:-}")"

if [[ ! -f "${KEY_PATH}" ]]; then
  echo "[notarize-macos-dmg] key file not found: ${KEY_PATH}" >&2
  exit 1
fi
if [[ ! -f "${DMG_PATH}" ]]; then
  echo "[notarize-macos-dmg] dmg not found: ${DMG_PATH}" >&2
  exit 1
fi

echo "[notarize-macos-dmg] submitting ${DMG_PATH}"

signature="$(codesign -dv --verbose=2 "${DMG_PATH}" 2>&1 || true)"
if ! grep -q "Authority=Developer ID Application" <<<"${signature}"; then
  if [[ "${PIWIN_REQUIRE_NOTARIZED:-}" == "1" ]]; then
    echo "[notarize-macos-dmg] Developer ID signature required before notarization" >&2
    printf '%s\n' "${signature}" >&2
    exit 1
  fi
  echo "[notarize-macos-dmg] skip: ${DMG_PATH} is not Developer ID signed (Apple will reject ad-hoc)"
  exit 0
fi

xcrun notarytool submit "${DMG_PATH}" \
  --key "${KEY_PATH}" \
  --key-id "${APPLE_API_KEY}" \
  --issuer "${APPLE_API_ISSUER}" \
  --wait

echo "[notarize-macos-dmg] stapling ${DMG_PATH}"
xcrun stapler staple "${DMG_PATH}"
xcrun stapler validate "${DMG_PATH}"
echo "[notarize-macos-dmg] ok"
