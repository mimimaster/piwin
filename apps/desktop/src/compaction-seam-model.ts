/**
 * View model for the compaction seam drawn in the transcript.
 *
 * Copy, token delta and file chips are derived here so the component stays a
 * plain renderer and the wording rules stay unit-testable. The Host's own
 * prose ("Context compacted") only repeats the label, so it is never shown;
 * a failure reason is the one Host string worth surfacing.
 */
import type { CompactionActivityUi } from './chat-reducer.js';
import { formatUsageDurationMs, formatUsageTokenCount } from './conversation-usage-copy.js';

export type CompactionSeamLocale = 'zh-CN' | 'en';

export type CompactionSeamTone = 'live' | 'done' | 'failed' | 'cancelled';

export type CompactionSeamFile = {
  path: string;
  name: string;
  modified: boolean;
};

export type CompactionSeamModel = {
  tone: CompactionSeamTone;
  label: string;
  /** `571K → 21K`; null when the Host reported no token counts. */
  tokens: string | null;
  before: string | null;
  after: string | null;
  /** `−96%`; null unless compaction actually shrank the context. */
  reduction: string | null;
  /** Settled duration; the running row shows a live clock instead. */
  duration: string | null;
  reason: string | null;
  /** Short explanation for a settled-but-unchanged outcome (cancelled). */
  note: string | null;
  /** after / before, clamped to [0, 1], for the before/after bar. */
  ratio: number | null;
  failure: string | null;
  summary: string | null;
  files: CompactionSeamFile[];
  filesOmitted: number;
  /** Nothing to unfold for a running, cancelled or detail-less row. */
  expandable: boolean;
};

/** Host fallback text for `ok: false` without a message; not worth showing. */
const GENERIC_FAILURE_MESSAGE = 'Compaction finished with errors';

const MAX_SEAM_FILES = 6;

/** A running compaction hides the run status footer; a settled one never does. */
export function isCompactionRunning(
  activity: CompactionActivityUi | null | undefined,
): boolean {
  return activity?.phase === 'running';
}

function resolveLabel(phase: CompactionActivityUi['phase'], isZh: boolean): string {
  switch (phase) {
    case 'running':
      return isZh ? '正在压缩上下文…' : 'Compacting context…';
    case 'succeeded':
      return isZh ? '已压缩上下文' : 'Context compacted';
    case 'failed':
      return isZh ? '上下文压缩失败' : 'Compaction failed';
    case 'cancelled':
      return isZh ? '已取消压缩' : 'Compaction cancelled';
  }
}

function resolveTone(phase: CompactionActivityUi['phase']): CompactionSeamTone {
  switch (phase) {
    case 'running':
      return 'live';
    case 'succeeded':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

function resolveReason(reason: CompactionActivityUi['reason'], isZh: boolean): string | null {
  switch (reason) {
    case 'manual':
      return isZh ? '手动压缩' : 'Manual compaction';
    case 'threshold':
      return isZh ? '自动压缩 · 接近上下文窗口上限' : 'Automatic · nearing the context window limit';
    case 'overflow':
      return isZh ? '自动压缩 · 上下文超出模型窗口' : 'Automatic · context exceeded the model window';
    case 'unknown':
      return null;
  }
}

function resolveDurationMs(activity: CompactionActivityUi): number | undefined {
  if (typeof activity.durationMs === 'number') {
    return Math.max(0, activity.durationMs);
  }
  if (activity.endedAt !== undefined) {
    return Math.max(0, activity.endedAt - activity.startedAt);
  }
  return undefined;
}

function baseName(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
}

function resolveFiles(fileOps: CompactionActivityUi['fileOps']): {
  files: CompactionSeamFile[];
  omitted: number;
} {
  if (fileOps === undefined) {
    return { files: [], omitted: 0 };
  }
  // Modified files first: they are the ones a reader most wants to see kept.
  const ordered: CompactionSeamFile[] = [
    ...fileOps.modifiedFiles.map((path) => ({ path, name: baseName(path), modified: true })),
    ...fileOps.readFiles
      .filter((path) => !fileOps.modifiedFiles.includes(path))
      .map((path) => ({ path, name: baseName(path), modified: false })),
  ];
  const files = ordered.slice(0, MAX_SEAM_FILES);
  return {
    files,
    omitted: ordered.length - files.length + (fileOps.omittedCount ?? 0),
  };
}

export function resolveCompactionSeamModel(
  activity: CompactionActivityUi,
  locale: CompactionSeamLocale,
): CompactionSeamModel {
  const isZh = locale === 'zh-CN';
  const settled = activity.phase === 'succeeded';
  const { tokensBefore, tokensAfter } = activity;

  const before =
    settled && tokensBefore !== undefined ? formatUsageTokenCount(tokensBefore) : null;
  const after = settled && tokensAfter !== undefined ? formatUsageTokenCount(tokensAfter) : null;
  const tokens = after === null ? null : before === null ? after : `${before} → ${after}`;

  let ratio: number | null = null;
  let reduction: string | null = null;
  if (
    settled &&
    tokensBefore !== undefined &&
    tokensAfter !== undefined &&
    tokensBefore > 0
  ) {
    ratio = Math.min(1, Math.max(0, tokensAfter / tokensBefore));
    const percent = Math.round((1 - ratio) * 100);
    reduction = percent > 0 ? `−${percent}%` : null;
  }

  const durationMs = resolveDurationMs(activity);
  const duration =
    activity.phase !== 'running' && durationMs !== undefined
      ? formatUsageDurationMs(durationMs)
      : null;

  const failureMessage = activity.message?.trim() ?? '';
  const failure =
    activity.phase === 'failed'
      ? failureMessage.length > 0 && failureMessage !== GENERIC_FAILURE_MESSAGE
        ? failureMessage
        : null
      : null;

  const summary = settled && activity.summary?.trim() ? activity.summary.trim() : null;
  const { files, omitted } = settled ? resolveFiles(activity.fileOps) : { files: [], omitted: 0 };
  const reason = resolveReason(activity.reason, isZh);

  return {
    tone: resolveTone(activity.phase),
    label: resolveLabel(activity.phase, isZh),
    tokens,
    before,
    after,
    reduction,
    duration,
    reason,
    note:
      activity.phase === 'cancelled' ? (isZh ? '上下文保持不变' : 'Context unchanged') : null,
    ratio,
    failure,
    summary,
    files,
    filesOmitted: omitted,
    expandable: settled && (tokens !== null || summary !== null || files.length > 0 || reason !== null),
  };
}
