import type { PermissionMode } from '@piwin/contracts';
import { modeToPreset, resolvePreset, type PermissionPreset } from '@piwin/contracts';

/**
 * Read a `--name value` pair from argv, returning `undefined` when the flag is
 * absent or has no following token.
 */
function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export type ParsePermissionModeOverrideResult = {
  mode: PermissionMode | undefined;
  /** `true` when the bypass came from the dangerous alias (for stderr warning). */
  fromDangerousAlias: boolean;
};

/**
 * Parse the session-level permission mode override (ADR 0019 §3, ADR 0024).
 *
 * Accepts both legacy mode values (`auto`/`ask-all`/`bypass`) and new Run Mode
 * preset values (`ask`/`auto`/`yolo`). `--yolo` is a shorthand flag. The
 * `--dangerously-bypass-permissions` flag is an alias for `yolo`/`bypass`.
 * Returns `mode: undefined` when no flag is present so the configured
 * `config.permissions` applies. Throws on an invalid value.
 */
export function parsePermissionModeOverride(argv: string[]): ParsePermissionModeOverrideResult {
  if (hasFlag(argv, '--dangerously-bypass-permissions')) {
    return { mode: 'bypass', fromDangerousAlias: true };
  }
  if (hasFlag(argv, '--yolo')) {
    return { mode: 'bypass', fromDangerousAlias: true };
  }
  const value = readOption(argv, '--permission-mode');
  if (value === undefined) {
    return { mode: undefined, fromDangerousAlias: false };
  }
  // Legacy mode values (backward compat).
  if (value === 'auto' || value === 'ask-all' || value === 'bypass') {
    return { mode: value, fromDangerousAlias: false };
  }
  // ADR 0024 Run Mode preset values.
  if (value === 'ask' || value === 'yolo') {
    const preset = value as PermissionPreset;
    return { mode: resolvePreset(preset).mode, fromDangerousAlias: value === 'yolo' };
  }
  throw new Error(
    `Invalid --permission-mode value: ${value} (expected auto|ask-all|bypass|ask|yolo)`,
  );
}
