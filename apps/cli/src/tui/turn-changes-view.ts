import type { SelectItem } from '@earendil-works/pi-tui';
import type { TurnChangeAvailability, TurnChangeRepairPreview, TurnChangeSummary } from '@piwin/contracts';
import type { TranscriptState } from './transcript-model.js';

/**
 * File changes per turn, and whether the Host can take them back. Pure — the
 * Host records the changes and performs every undo and redo.
 */

export type TurnChangeAction = 'files' | 'undo' | 'redo' | 'repair' | 'close';

const PREVIEW_CHARS = 40;
const MAX_LISTED_PATHS = 6;

const BLOCK_REASON: Record<Extract<TurnChangeAvailability, { allowed: false }>['reason'], string> = {
  'unsupported-workspace': '这个工作区不支持撤销',
  'capture-incomplete': '这一轮的改动没有完整记录下来',
  'data-expired': '记录已过期',
  'workspace-busy': '工作区正忙',
  'workspace-restoring': '工作区正在恢复',
  'stale-revision': '记录已更新，重新打开再试',
  'files-changed': '这些文件之后又被改过',
  'staged-paths': '有文件已暂存或处于冲突状态',
  'backup-failed': '无法保存撤销前的备份',
  'needs-repair': '上一次操作没有完成，需要先修复',
  'permission-denied': '没有读写这些文件的权限',
  'direction-unavailable': '当前状态下不能这样做',
  'capture-pending': '这一轮还在进行或尚未记录完',
  'no-changes': '这一轮没有改动文件',
};

/** The Host refuses an undo with the reason code as its error text; say it in words. */
export function describeRefusal(errorText: string): string {
  if (errorText === 'unsupported-capability') return '这个 Host 没有记录文件改动';
  return (BLOCK_REASON as Record<string, string | undefined>)[errorText] ?? errorText;
}

/** Run ids of the transcript on screen, oldest first, without repeats. */
export function transcriptRunIds(transcript: TranscriptState): string[] {
  const runIds: string[] = [];
  for (const entry of transcript.entries) {
    if (entry.kind === 'message' && entry.runId !== undefined && !runIds.includes(entry.runId)) {
      runIds.push(entry.runId);
    }
  }
  return runIds;
}

/** Turns that actually touched files, newest first. */
export function turnsWithChanges(
  summaries: readonly TurnChangeSummary[],
  runOrder: readonly string[],
): TurnChangeSummary[] {
  const position = (summary: TurnChangeSummary): number =>
    Math.max(-1, ...summary.runIds.map((runId) => runOrder.indexOf(runId)));
  return summaries
    .filter((summary) => (summary.fileCount ?? 0) > 0 || summary.captureState === 'incomplete')
    .sort((left, right) => position(right) - position(left));
}

function describeCounts(summary: TurnChangeSummary): string {
  const files = summary.fileCount === null ? '改动未知' : `${summary.fileCount} 个文件`;
  const lines =
    summary.additions === null || summary.deletions === null ? '' : ` +${summary.additions} −${summary.deletions}`;
  return `${files}${lines}`;
}

/** How a turn's prompt reads in the list; the summary only knows its message id. */
function promptPreview(summary: TurnChangeSummary, transcript: TranscriptState): string {
  const entry = transcript.entries.find(
    (candidate) => candidate.kind === 'message' && candidate.id === summary.userMessageId,
  );
  const text = entry?.kind === 'message' ? entry.text.replace(/\s+/g, ' ').trim() : '';
  if (text.length === 0) return '（提问不在当前页）';
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

export function turnChangeItems(turns: readonly TurnChangeSummary[], transcript: TranscriptState): SelectItem[] {
  return turns.map((summary) => ({
    value: summary.changeSetId,
    label: promptPreview(summary, transcript),
    description: [
      describeCounts(summary),
      summary.disposition === 'undone' ? '已撤销' : undefined,
      summary.coverageComplete ? undefined : '记录不完整',
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · '),
  }));
}

/** Why an undo or redo is refused, with the paths in the way when the Host names them. */
export function describeBlocked(availability: TurnChangeAvailability): string | undefined {
  if (availability.allowed) return undefined;
  const reason = BLOCK_REASON[availability.reason];
  const paths = availability.conflicts?.map((conflict) => conflict.relativePath) ?? availability.affectedPaths ?? [];
  if (paths.length === 0) return reason;
  const listed = paths.slice(0, MAX_LISTED_PATHS).join('、');
  return `${reason}：${listed}${paths.length > MAX_LISTED_PATHS ? ` 等 ${paths.length} 个` : ''}`;
}

/** Offered: view, then whichever of undo and redo fits the turn's state; a refusal carries its reason. */
export function turnChangeActionItems(summary: TurnChangeSummary): SelectItem[] {
  const items: SelectItem[] = [];
  if ((summary.fileCount ?? 0) > 0) items.push({ value: 'files', label: '查看改动的文件' });
  const undone = summary.disposition === 'undone';
  const [action, label, availability] = undone
    ? (['redo', '恢复这一轮的改动', summary.redo] as const)
    : (['undo', '撤销这一轮的改动', summary.undo] as const);
  const blocked = describeBlocked(availability);
  if (needsRepair(summary)) {
    items.push({
      value: 'repair',
      label: '修复上次没完成的操作',
      description: '一次撤销或恢复写到一半停了，先把文件放回去',
    });
  } else if (blocked === undefined) {
    items.push({ value: action, label, description: undone ? '把文件改回这一轮结束时的样子' : '把文件改回这一轮开始前的样子' });
  } else {
    items.push({ value: 'close', label: `${label}（不可用）`, description: blocked });
  }
  items.push({ value: 'close', label: '关闭' });
  return items;
}

/** An undo or redo of this turn stopped half way and the Host can name the operation. */
export function needsRepair(summary: TurnChangeSummary): boolean {
  const stuck = (availability: TurnChangeAvailability): boolean =>
    !availability.allowed && availability.reason === 'needs-repair';
  return summary.latestOperationId !== null && (stuck(summary.undo) || stuck(summary.redo));
}

const REPAIR_STATE: Record<TurnChangeRepairPreview['files'][number]['state'], string> = {
  restored: '已是操作前的样子',
  'operation-content': '会放回操作前的样子',
  foreign: '被别的改动动过，不会覆盖',
};

/** What a repair would do, file by file, and whether it can finish the job. */
export function renderRepairPreview(preview: TurnChangeRepairPreview): string {
  const foreign = preview.files.filter((file) => file.state === 'foreign').length;
  return [
    ...preview.files.map((file) => `${file.relativePath} — ${REPAIR_STATE[file.state]}`),
    '',
    foreign === 0
      ? '修复后这一轮可以重新撤销或恢复。'
      : `有 ${foreign} 个文件不会被覆盖，需要你手动处理后再修复一次。`,
  ].join('\n');
}

/** A line for the transcript when a turn's changes are taken back or restored. */
export function describeDispositionChange(
  previous: TurnChangeSummary | undefined,
  next: TurnChangeSummary,
): string | undefined {
  if (previous === undefined || previous.disposition === next.disposition) return undefined;
  const count = next.fileCount === null ? '' : ` ${next.fileCount} 个文件`;
  if (next.disposition === 'undone') {
    const left = next.leftInPlacePaths?.length ?? 0;
    return `已撤销${count}的改动${left > 0 ? `（${left} 个之后被改过的文件保持原样）` : ''}`;
  }
  return next.disposition === 'applied' ? `已恢复${count}的改动` : undefined;
}
