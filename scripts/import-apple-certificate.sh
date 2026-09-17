#!/usr/bin/env bash
# Import a Developer ID .p12 into a temporary keychain for GitHub-hosted
# macOS packaging. sign-host-macho runs before `tauri build`, so Tauri's
# own APPLE_CERTIFICATE import is too late for Host natives.
#
# Required env (import):
#   APPLE_CERTIFICATE            base64-encoded .p12
#   APPLE_CERTIFICATE_PASSWORD   p12 password
# Optional:
#   APPLE_SIGNING_IDENTITY       skip identity discovery when already set
#   RUNNER_TEMP                  GitHub Actions temp dir
#
# Usage:
#   bash scripts/import-apple-certificate.sh
#   bash scripts/import-apple-certificate.sh --cleanup
set -euo pipefail

TEMP_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
TEMP_ROOT="${TEMP_ROOT%/}"
KEYCHAIN_PATH="${TEMP_ROOT}/piwin-signing.keychain-db"
P12_PATH="${TEMP_ROOT}/piwin-signing.p12"
PASSWORD_PATH="${TEMP_ROOT}/piwin-signing-keychain-password"
DEFAULT_KEYCHAIN_PATH="${TEMP_ROOT}/piwin-signing-default-keychain"
SEARCH_LIST_PATH="${TEMP_ROOT}/piwin-signing-keychain-search"

cleanup() {
  if [[ -f "${DEFAULT_KEYCHAIN_PATH}" ]]; then
    local original_default
    original_default="$(<"${DEFAULT_KEYCHAIN_PATH}")"
    if [[ -n "${original_default}" ]]; then
      security default-keychain -d user -s "${original_default}" || true
    fi
  fi
  if [[ -f "${SEARCH_LIST_PATH}" ]]; then
    # Restore the previous search list as separate arguments.
    # shellcheck disable=SC2046
    security list-keychain -d user -s $(<"${SEARCH_LIST_PATH}") || true
  fi
  if [[ -f "${KEYCHAIN_PATH}" ]]; then
    security delete-keychain "${KEYCHAIN_PATH}" || true
  fi
  rm -f "${P12_PATH}" "${PASSWORD_PATH}" "${DEFAULT_KEYCHAIN_PATH}" "${SEARCH_LIST_PATH}"
  echo "[import-apple-certificate] cleaned temporary keychain"
}

if [[ "${1:-}" == "--cleanup" ]]; then
  cleanup
  exit 0
fi

if [[ -z "${APPLE_CERTIFICATE:-}" ]]; then
  echo "[import-apple-certificate] skip: APPLE_CERTIFICATE unset"
  exit 0
fi
if [[ -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]]; then
  echo "[import-apple-certificate] APPLE_CERTIFICATE_PASSWORD is required when APPLE_CERTIFICATE is set" >&2
  exit 1
fi

KEYCHAIN_PASSWORD="$(openssl rand -base64 24)"
printf '%s' "${KEYCHAIN_PASSWORD}" > "${PASSWORD_PATH}"
chmod 600 "${PASSWORD_PATH}"

security default-keychain -d user | tr -d '"' > "${DEFAULT_KEYCHAIN_PATH}"
security list-keychain -d user | tr -d '"' | tr '\n' ' ' > "${SEARCH_LIST_PATH}"

rm -f "${KEYCHAIN_PATH}"
security create-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_PATH}"
security set-keychain-settings -lut 21600 "${KEYCHAIN_PATH}"
security unlock-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_PATH}"

printf '%s' "${APPLE_CERTIFICATE}" | base64 --decode > "${P12_PATH}"
security import "${P12_PATH}" \
  -P "${APPLE_CERTIFICATE_PASSWORD}" \
  -A \
  -t cert \
  -f pkcs12 \
  -k "${KEYCHAIN_PATH}"
rm -f "${P12_PATH}"

# Keep login/search list so system roots remain visible; put ours first.
# shellcheck disable=SC2046
security list-keychain -d user -s "${KEYCHAIN_PATH}" $(<"${SEARCH_LIST_PATH}")
security default-keychain -d user -s "${KEYCHAIN_PATH}"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_PATH}" >/dev/null

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  discovered="$(
    security find-identity -v -p codesigning "${KEYCHAIN_PATH}" \
      | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' \
      | sort -u
  )"
  identity_count="$(printf '%s\n' "${discovered}" | grep -c . || true)"
  if [[ "${identity_count}" -eq 0 ]]; then
    echo "[import-apple-certificate] imported p12 has no Developer ID Application identity" >&2
    security find-identity -v -p codesigning "${KEYCHAIN_PATH}" >&2 || true
    exit 1
  fi
  if [[ "${identity_count}" -gt 1 ]]; then
    echo "[import-apple-certificate] several Developer ID identities; set APPLE_SIGNING_IDENTITY:" >&2
    printf '%s\n' "${discovered}" >&2
    exit 1
  fi
  APPLE_SIGNING_IDENTITY="${discovered}"
fi

if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    echo "APPLE_SIGNING_IDENTITY=${APPLE_SIGNING_IDENTITY}"
  } >> "${GITHUB_ENV}"
fi

echo "[import-apple-certificate] signing as ${APPLE_SIGNING_IDENTITY}"
