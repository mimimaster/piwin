import { truncateToWidth } from '@earendil-works/pi-tui';
import type { ToolFileChange } from '@piwin/contracts';
import { style } from './tui-style.js';

/** Unified-diff colouring; text that is not a diff passes through. */
export function paintDiffLine(line: string): string {
  const text = line.replace(/\t/g, '  ');
  if (text.startsWith('+++') || text.startsWith('---')) return style.bold(text);
  if (text.startsWith('@@')) return style.cyan(text);
  if (text.startsWith('+')) return style.green(text);
  if (text.startsWith('-')) return style.red(text);
  return text;
}

/** Hunks only: `diff --git`, `index`, `---`/`+++` headers say nothing a reader needs here. */
export function patchBody(patch: string): string[] {
  const lines = patch.replace(/\n$/, '').split('\n');
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  return firstHunk < 0 ? lines.filter((line) => !/^(diff |index |--- |\+\+\+ )/.test(line)) : lines.slice(firstHunk);
}

/** Count added/removed lines of a unified patch (headers excluded). */
export function countPatch(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patchBody(patch)) {
    if (line.startsWith('+')) additions += 1;
    else if (line.startsWith('-')) deletions += 1;
  }
  return { additions, deletions };
}

/** `+12 −3`, coloured; empty for a change without counts (binary). */
export function formatDiffStat(additions: number | null, deletions: number | null): string {
  if (additions === null || deletions === null) return '';
  return `${style.green(`+${additions}`)} ${style.red(`−${deletions}`)}`;
}

/** Lines shown under an edit while tool output is folded. */
export const FOLDED_DIFF_LINES = 6;

/**
 * The diff under a file-editing tool line: stats always, then the first few
 * hunk lines while folded, the whole patch once Ctrl+O expands tool output.
 */
export function renderFileChange(change: ToolFileChange, width: number, expanded: boolean): string[] {
  const stat = change.binary ? style.gray('二进制文件') : formatDiffStat(change.additions, change.deletions);
  const verb = change.status === 'added' ? '新建' : change.status === 'deleted' ? '删除' : '修改';
  const lines = [truncateToWidth(`   ${style.gray(`${verb} ${change.path}`)}${stat.length > 0 ? ` ${stat}` : ''}`, width)];
  if (change.patch === undefined || change.patch.length === 0) return lines;
  const body = patchBody(change.patch);
  const shown = expanded ? body : body.slice(0, FOLDED_DIFF_LINES);
  for (const line of shown) lines.push(truncateToWidth(`   ${style.gray('│')} ${paintDiffLine(line)}`, width));
  if (shown.length < body.length) {
    lines.push(truncateToWidth(`   ${style.gray(`… 还有 ${body.length - shown.length} 行 · Ctrl+O 展开`)}`, width));
  }
  return lines;
}
