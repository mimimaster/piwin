/**
 * Browser-safe shell tool classification shared across session summaries,
 * transcript snapshot gating, and Desktop UI cards.
 */
import type { SessionToolCardView } from '@piwin/contracts';

export const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'bash',
  'shell',
  'zsh',
  'sh',
  'run_command',
  'exec',
]);

export type ShellToolCandidate = {
  toolName?: string | undefined;
  presentation?:
    | { kind?: NonNullable<SessionToolCardView['presentation']>['kind'] | undefined }
    | undefined;
};

/**
 * Identify shell/command tools (`bash`, `shell`, `zsh`, `sh`, `run_command`,
 * `exec`, or `presentation.kind === 'shell'`).
 */
export function isShellFamilyTool(tool: ShellToolCandidate): boolean {
  if (tool.presentation?.kind === 'shell') {
    return true;
  }
  return SHELL_TOOL_NAMES.has((tool.toolName ?? '').toLowerCase());
}
