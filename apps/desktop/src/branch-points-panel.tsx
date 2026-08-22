/**
 * In-session branch points (ADR 0055 §5.4 first version: the fork-point list;
 * tree visualization stays deferred).
 *
 * One group per fork on the active path, one row per sibling branch. Clicking
 * a row switches the active branch, which is also the only place branching is
 * advertised before it has happened — the inline ‹n/m› switcher only appears
 * once a fork exists, so the empty state carries the instructions.
 */

import type { ReactElement } from 'react';
import type { TranscriptBranchPoint } from '@piwin/contracts';
import { IconCheck, IconFileDiff } from './shell-icons';
import type { DesktopLocale } from './desktop-locale';
import { formatTimestamp } from './format-timestamp';

export type BranchPointsPanelProps = {
  branchPoints: TranscriptBranchPoint[];
  /** Switching is refused while a run holds the session (`run-active`). */
  disabled?: boolean;
  onSwitch: (headMessageId: string) => void;
  locale: DesktopLocale;
};

export function BranchPointsPanel(props: BranchPointsPanelProps): ReactElement {
  const isZh = props.locale === 'zh-CN';

  if (props.branchPoints.length === 0) {
    return (
      <div className="branch-points-panel" data-testid="branch-points-panel">
        <p className="right-panel-empty muted" data-testid="branch-points-empty">
          {isZh
            ? '这条会话还没有分支。编辑你发过的任意一条消息再发送一次，对话就会就地分叉：原来的后续会被保留成另一条分支，随时可以切回来。'
            : 'This conversation has no branches yet. Edit any message you sent and send it again: the conversation forks in place and the previous continuation is kept as a branch you can switch back to.'}
        </p>
      </div>
    );
  }

  return (
    <div className="branch-points-panel" data-testid="branch-points-panel">
      {props.branchPoints.map((point, pointIndex) => (
        <section
          className="branch-point-group"
          key={point.anchorMessageId ?? `root-${String(pointIndex)}`}
        >
          <div className="branch-point-caption muted">
            {isZh
              ? `分叉点 ${String(pointIndex + 1)} · ${String(point.siblings.length)} 条分支`
              : `Fork ${String(pointIndex + 1)} · ${String(point.siblings.length)} branches`}
          </div>
          <ul className="branch-point-list">
            {point.siblings.map((sibling, index) => {
              const isActive = index === point.activeIndex;
              const meta = [
                isZh
                  ? `${String(sibling.messageCount)} 条消息`
                  : `${String(sibling.messageCount)} messages`,
                formatTimestamp(sibling.updatedAt, isZh),
              ]
                .filter((part) => part.length > 0)
                .join(' · ');
              return (
                <li key={sibling.headMessageId}>
                  <button
                    type="button"
                    className={
                      isActive ? 'branch-point-item branch-point-item--active' : 'branch-point-item'
                    }
                    disabled={isActive || props.disabled === true}
                    {...(isActive ? { 'aria-current': 'true' as const } : {})}
                    onClick={() => props.onSwitch(sibling.headMessageId)}
                    data-testid="branch-point-item"
                    data-branch-head={sibling.headMessageId}
                  >
                    <span className="branch-point-ordinal">{index + 1}</span>
                    <span className="branch-point-text">
                      <span className="branch-point-preview">
                        {sibling.preview.trim().length > 0
                          ? sibling.preview
                          : isZh
                            ? '（无文本）'
                            : '(no text)'}
                      </span>
                      {sibling.leafPreview.trim().length > 0 ? (
                        <span className="branch-point-leaf muted">{sibling.leafPreview}</span>
                      ) : null}
                      <span className="branch-point-meta muted">{meta}</span>
                    </span>
                    <span className="branch-point-marks">
                      {sibling.writesWorkspace ? (
                        <span
                          className="branch-point-write"
                          title={isZh ? '这条分支改过工作区文件' : 'This branch changed files'}
                          aria-label={
                            isZh ? '这条分支改过工作区文件' : 'This branch changed files'
                          }
                          data-testid="branch-point-write-mark"
                        >
                          <IconFileDiff width={13} height={13} />
                        </span>
                      ) : null}
                      {isActive ? (
                        <span
                          className="branch-point-active"
                          title={isZh ? '当前分支' : 'Active branch'}
                          aria-label={isZh ? '当前分支' : 'Active branch'}
                        >
                          <IconCheck width={13} height={13} />
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
