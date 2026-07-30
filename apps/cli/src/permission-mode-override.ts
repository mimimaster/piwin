import type { PermissionMode } from '@piwin/contracts';

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
 * Parse the session-level permission mode override (ADR 0019 §3).
 *
 * `--permission-mode <auto|ask-all|bypass>` takes precedence; the
 * `--dangerously-bypass-permissions` flag is an alias for `bypass`. Returns
 * `mode: undefined` when neither flag is present so the configured
 * `config.permissions.mode` applies. Throws on an invalid `--permission-mode`
 * value so the CLI surfaces a clear usage error.
 */
export function parsePermissionModeOverride(
  argv: string[],
): ParsePermissionModeOverrideResult {
  if (hasFlag(argv, '--dangerously-bypass-permissions')) {
    return { mode: 'bypass', fromDangerousAlias: true };
  }
  const value = readOption(argv, '--permission-mode');
  if (value === undefined) {
    return { mode: undefined, fromDangerousAlias: false };
  }
  if (value === 'auto' || value === 'ask-all' || value === 'bypass') {
    return { mode: value, fromDangerousAlias: false };
  }
  throw new Error(
    `Invalid --permission-mode value: ${value} (expected auto|ask-all|bypass)`,
  );
}
