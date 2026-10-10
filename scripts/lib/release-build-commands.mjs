/**
 * Pure command/verdict builders for the two installer lanes.
 * Windows runs one PowerShell script over SSH; the macOS gate decides whether
 * a DMG may be uploaded at all.
 */
import { interpretCodesignDump } from './verify-desktop-package.mjs';

/** @param {string} value */
function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The checkout is reset to the exact release commit, never to a branch name:
 * an installer built from "whatever origin/main was" is the failure this
 * replaces. `$LASTEXITCODE` is checked per step because PowerShell keeps going
 * after a failed native command.
 *
 * @param {{ dir: string, commit: string, version: string }} input
 * @returns {string}
 */
export function windowsBuildScript(input) {
  const steps = [
    ['git fetch', 'git fetch origin --prune'],
    ['git reset', `git reset --hard ${input.commit}`],
    ['pnpm install', 'pnpm install --frozen-lockfile --ignore-scripts'],
    ['apply version', `node scripts/apply-desktop-version.mjs ${input.version}`],
    ['bundle host', 'pnpm bundle:host'],
    ['fetch node runtime', 'pnpm fetch:node-runtime'],
    ['tauri build', 'pnpm --dir apps/desktop package'],
  ];
  const lines = [
    "$ErrorActionPreference = 'Continue'",
    "$ProgressPreference = 'SilentlyContinue'",
    'function Invoke-ReleaseStep([string]$label, [scriptblock]$body) {',
    '  $started = Get-Date',
    '  Write-Output "[release-win] start $label"',
    '  & $body',
    '  if ($LASTEXITCODE -ne 0) { Write-Output "[release-win] failed $label (exit $LASTEXITCODE)"; exit 1 }',
    '  Write-Output ("[release-win] done {0} {1:n0}s" -f $label, ((Get-Date) - $started).TotalSeconds)',
    '}',
    `Set-Location -LiteralPath ${quotePowerShell(input.dir)}`,
  ];
  for (const [label, command] of steps) {
    lines.push(`Invoke-ReleaseStep ${quotePowerShell(label)} { ${command} }`);
    if (label === 'git reset') {
      lines.push(
        '$head = (git rev-parse HEAD).Trim()',
        `if ($head -ne ${quotePowerShell(input.commit)}) { Write-Output "[release-win] HEAD $head is not the release commit"; exit 3 }`,
      );
    }
  }
  lines.push('Write-Output "[release-win] HEAD=$head"');
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * The script is copied to the build box and run with `powershell -File`.
 * Passing it inline (`-EncodedCommand`, or stdin) proved unreliable over
 * OpenSSH on Windows: some payloads hung for 30s and exited with no output.
 * Relative to the SSH user's home directory.
 */
export const WINDOWS_BUILD_SCRIPT_NAME = 'piwin-release-build.ps1';

/**
 * scp accepts forward slashes for Windows drives (`host:D:/Codes/...`).
 *
 * @param {string} dir Windows checkout, e.g. D:\Codes\piwin
 * @param {string} builtFileName
 */
export function windowsInstallerScpPath(dir, builtFileName) {
  const root = dir.replaceAll('\\', '/').replace(/\/+$/, '');
  return `${root}/apps/desktop/src-tauri/target/release/bundle/nsis/${builtFileName}`;
}

/**
 * A DMG is uploadable only when it is Developer ID signed, stapled, and
 * Gatekeeper reports it as notarized. "Signed" alone is a failed release.
 *
 * @param {{ codesign: string, staplerOk: boolean, spctl: string }} evidence
 * @returns {string[]} failures; empty means the gate passed
 */
export function macGateFailures(evidence) {
  const failures = [];
  if (!interpretCodesignDump(evidence.codesign).developerId) {
    failures.push('codesign: no Developer ID Application authority');
  }
  if (!evidence.staplerOk) failures.push('stapler validate failed');
  if (!/\baccepted\b/.test(evidence.spctl)) failures.push('spctl: not accepted');
  if (!/source=Notarized Developer ID/.test(evidence.spctl)) {
    failures.push('spctl: source is not "Notarized Developer ID"');
  }
  return failures;
}
