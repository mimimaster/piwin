/**
 * Footer pieces of the turn card: one status line (icon + text + optional
 * action), path chips, and why undo/redo is not offered when that is not
 * obvious from the card itself.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import type { TurnChangeBlockReason, TurnChangeSummary } from '@piwin/contracts';

import { IconTerminal, IconWarn } from '../shell-icons.js';
import type { TurnChangeRefusal } from './turn-change-gesture.js';

export type Copy = (zh: string, en: string) => string;

export function StatusFoot(props: {
  tone: 'info' | 'warn' | 'error';
  testId: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const Glyph = props.tone === 'info' ? IconTerminal : IconWarn;
  return (
    <div
      className={`turn-change-bar-foot ${props.tone}`}
      role={props.tone === 'error' ? 'alert' : undefined}
      data-testid={props.testId}
    >
      <Glyph className="i turn-change-bar-foot-glyph" />
      <div className="turn-change-bar-foot-body">{props.children}</div>
      {props.action}
    </div>
  );
}

export function PathChips(props: { paths: readonly string[] }): ReactElement {
  return (
    <span className="turn-change-bar-chips">
      {props.paths.map((path) => (
        <code key={path} className="turn-change-bar-chip" title={path}>
          {path}
        </code>
      ))}
    </span>
  );
}

/** Chips shown before a long path list folds (transcript card only). */
export const COLLAPSED_COMMAND_PATHS = 3;
export const COLLAPSED_OVERLAP_PATHS = 5;

/**
 * Path chips that fold behind one quiet toggle past `visible`. A single hidden
 * chip costs as much room as the toggle itself, so it is shown instead.
 * `defaultOpen` (the side panel) lists everything.
 */
export function CollapsiblePathChips(props: {
  paths: readonly string[];
  visible: number;
  defaultOpen?: boolean;
  /** Toggle text while folded, given how many paths are hidden. */
  moreLabel: (hidden: number) => string;
  lessLabel: string;
  testId: string;
}): ReactElement {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const hidden = props.paths.length - props.visible;
  const collapsible = hidden > 1;
  const shown = collapsible && !open ? props.paths.slice(0, props.visible) : props.paths;
  return (
    <>
      <PathChips paths={shown} />
      {collapsible ? (
        <button
          type="button"
          className="turn-change-bar-paths-more"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          data-testid={`${props.testId}-toggle`}
        >
          {open ? props.lessLabel : props.moreLabel(hidden)}
        </button>
      ) : null}
    </>
  );
}

/**
 * Files commands changed that Host could not image, inside the incomplete
 * note. The whole turn is already un-undoable there, so "not in the undo
 * scope" would say nothing: the card states how many, and the side panel
 * (`full`) lists them.
 */
export function ExcludedPaths(props: {
  paths: readonly string[];
  full: boolean;
  t: Copy;
}): ReactElement {
  const count = props.paths.length;
  return (
    <div className="turn-change-bar-foot-sub" data-testid="turn-change-bar-excluded">
      {props.t(`另有 ${count} 个文件由命令修改`, `${count} more files changed by commands`)}
      {props.full ? <PathChips paths={props.paths} /> : null}
    </div>
  );
}

/**
 * The files that block undo: a command changed them and the turn wrote them
 * too, and Host could not chain the two.
 */
export function OverlappingPaths(props: {
  paths: readonly string[];
  full: boolean;
  t: Copy;
}): ReactElement {
  return (
    <div className="turn-change-bar-foot-sub" data-testid="turn-change-bar-overlapping">
      {props.t('涉及这些文件', 'Files involved')}
      <CollapsiblePathChips
        paths={props.paths}
        visible={COLLAPSED_OVERLAP_PATHS}
        defaultOpen={props.full}
        moreLabel={(hidden) => props.t(`另有 ${hidden} 个`, `${hidden} more`)}
        lessLabel={props.t('收起', 'Show less')}
        testId="turn-change-bar-overlapping"
      />
    </div>
  );
}

/**
 * Why neither undo nor redo is offered when that is not obvious from the card
 * (记录不完整 and 没有改动 already explain themselves).
 */
export function AvailabilityFoot(props: { summary: TurnChangeSummary; t: Copy }): ReactElement | null {
  const { summary, t } = props;
  const current = summary.disposition === 'undone' ? summary.redo : summary.undo;
  if (current.allowed) return null;
  switch (current.reason) {
    case 'workspace-restoring':
      return (
        <StatusFoot tone="info" testId="turn-change-bar-restoring">
          {t('另一个客户端正在撤销或恢复这一轮…', 'Another client is undoing or restoring this turn…')}
        </StatusFoot>
      );
    case 'needs-repair':
      return (
        <StatusFoot tone="error" testId="turn-change-bar-needs-repair">
          {t(
            '上次撤销/恢复中途失败，部分文件需要修复。在「更改 → 更多 → 代码撤销记录」中处理。',
            'The last undo/restore failed midway and some files need repair. Fix it from Changes → More → Undo history.',
          )}
        </StatusFoot>
      );
    case 'data-expired':
      return (
        <StatusFoot tone="info" testId="turn-change-bar-expired">
          {t('本轮没有可用的撤销数据（已过保留期）', 'Undo data for this turn has expired')}
        </StatusFoot>
      );
    default:
      return null;
  }
}

const REFUSAL_REASONS = new Set<TurnChangeBlockReason>([
  'files-changed',
  'staged-paths',
  'backup-failed',
  'permission-denied',
]);

export function isRefusal(reason: TurnChangeBlockReason): reason is TurnChangeRefusal {
  return REFUSAL_REASONS.has(reason);
}

/** The footer line of a refusal: nothing was changed, and why (Spec §4). */
export function describeRefusal(
  direction: 'undo' | 'redo',
  reason: TurnChangeRefusal,
  count: number,
  t: Copy,
): string {
  const undo = direction === 'undo';
  switch (reason) {
    case 'files-changed':
      return undo
        ? t(
            `无法撤销：${count} 个文件在本轮结束后又被修改。为保留后续改动，本次未修改任何文件。`,
            `Cannot undo: ${count} files changed after this turn. Nothing was modified.`,
          )
        : t(
            `无法恢复：${count} 个文件在撤销后又被修改。本次未修改任何文件。`,
            `Cannot restore: ${count} files changed after the undo. Nothing was modified.`,
          );
    case 'staged-paths':
      return t(
        `当前 Git 状态不满足安全${undo ? '撤销' : '恢复'}条件：${count} 个文件有已暂存或未解决的冲突。本次未修改任何文件。`,
        `Git state does not allow a safe ${undo ? 'undo' : 'restore'}: ${count} files are staged or unmerged. Nothing was modified.`,
      );
    case 'backup-failed':
      return t(
        `${undo ? '撤销' : '恢复'}未执行，文件未改变：撤销数据不可用（可能已被清理或磁盘出错）。`,
        `${undo ? 'Undo' : 'Restore'} not applied; files unchanged: its backup data is not available.`,
      );
    case 'permission-denied':
      return t(
        `${undo ? '撤销' : '恢复'}未执行，文件未改变：Host 没有权限读写 ${count} 个文件。`,
        `${undo ? 'Undo' : 'Restore'} not applied; files unchanged: the Host cannot read or write ${count} files.`,
      );
  }
}
