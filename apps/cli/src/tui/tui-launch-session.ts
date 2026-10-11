/**
 * Pure parse of how a TUI launch picks its starting session.
 * Host list / open-picker side effects stay in tui-command.ts.
 */
export type TuiLaunchSessionIntent =
  | { kind: 'none' }
  | { kind: 'session'; sessionId: string }
  | { kind: 'continue' }
  | { kind: 'picker' };

/**
 * Priority: `--session` / `--resume <id>` / `-r <id>` → that id.
 * Bare `--resume` / `-r` → open the session picker.
 * `--continue` / `-c` → latest session in scope.
 */
export function resolveTuiLaunchSessionIntent(argv: readonly string[]): TuiLaunchSessionIntent {
  const session = readOption(argv, '--session');
  if (session !== undefined && session.length > 0) return { kind: 'session', sessionId: session };

  const resumeLong = readOption(argv, '--resume');
  if (resumeLong !== undefined) {
    return resumeLong.length > 0
      ? { kind: 'session', sessionId: resumeLong }
      : { kind: 'picker' };
  }
  if (hasBareFlag(argv, '--resume') || hasBareFlag(argv, '-r')) {
    return { kind: 'picker' };
  }
  const resumeShort = readOption(argv, '-r');
  if (resumeShort !== undefined) {
    return resumeShort.length > 0
      ? { kind: 'session', sessionId: resumeShort }
      : { kind: 'picker' };
  }

  if (argv.includes('--continue') || argv.includes('-c')) {
    return { kind: 'continue' };
  }
  return { kind: 'none' };
}

function readOption(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) return '';
  return value;
}

function hasBareFlag(argv: readonly string[], name: string): boolean {
  const index = argv.indexOf(name);
  if (index === -1) return false;
  const next = argv[index + 1];
  return next === undefined || next.startsWith('-');
}
