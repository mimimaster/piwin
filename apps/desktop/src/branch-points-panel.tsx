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
import { isAnswerVariantPoint, type TranscriptBranchPoint } from '@piwin/contracts';
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
            ? '改写某一轮的提问后发送，会在这里留下一个分叉。主对话区始终只显示当前这一路。'
            : 'Edit a sent prompt and change the text, then send: a fork appears here. The transcript always shows the active path.'}
        </p>
      </div>
    );
  }

  return (
    <div className="branch-points-panel" data-testid="branch-points-panel">
      {props.branchPoints.map((point, pointIndex) => {
        const sharedPrompt = point.promptPreview ?? point.siblings[0]?.preview ?? '';
        const answerVariants = isAnswerVariantPoint(point);
        return (
          <section
            className="branch-point-group"
            key={point.anchorMessageId ?? `root-${String(pointIndex)}`}
          >
            <div className="branch-point-header">
              <div className="branch-point-anchor-row">
                <span className="branch-point-anchor-dot" aria-hidden />
                <span className="branch-point-anchor-title" title={sharedPrompt}>
                  {sharedPrompt.trim().length > 0
                    ? sharedPrompt
                    : isZh
                      ? '会话起点'
                      : 'Root conversation'}
                </span>
              </div>
              <div className="branch-point-caption muted">
                {answerVariants
                  ? isZh
                    ? `${String(point.siblings.length)} 个回答版本`
                    : `${String(point.siblings.length)} answer versions`
                  : isZh
                    ? `分叉点 ${String(pointIndex + 1)} · ${String(point.siblings.length)} 条分支`
                    : `Fork ${String(pointIndex + 1)} · ${String(point.siblings.length)} branches`}
              </div>
            </div>

            <ul className="branch-point-list">
              {point.siblings.map((sibling, index) => {
                const isActive = index === point.activeIndex;
                const isLast = index === point.siblings.length - 1;
                const meta = [
                  isZh
                    ? `${String(sibling.messageCount)} 条消息`
                    : `${String(sibling.messageCount)} messages`,
                  formatTimestamp(sibling.updatedAt, isZh),
                ]
                  .filter((part) => part.length > 0)
                  .join(' · ');

                const isReworded =
                  !answerVariants &&
                  sharedPrompt.trim().length > 0 &&
                  sibling.preview.trim().length > 0 &&
                  sibling.preview.trim() !== sharedPrompt.trim();

                const primaryText =
                  sibling.responsePreview && sibling.responsePreview.trim().length > 0
                    ? sibling.responsePreview
                    : sibling.preview.trim().length > 0
                      ? sibling.preview
                      : sibling.leafPreview.trim().length > 0
                        ? sibling.leafPreview
                        : isZh
                          ? '（无文本）'
                          : '(no text)';

                const showContinuation =
                  sibling.leafPreview.trim().length > 0 &&
                  sibling.leafPreview.trim() !== primaryText.trim() &&
                  sibling.messageCount > 2;

                return (
                  <li key={sibling.headMessageId} className="branch-point-item-wrapper">
                    <span
                      className={`branch-point-rail-line ${isLast ? 'branch-point-rail-line--last' : ''}`}
                      aria-hidden
                    />
                    <button
                      type="button"
                      className={
                        isActive
                          ? 'branch-point-item branch-point-item--active'
                          : 'branch-point-item'
                      }
                      disabled={isActive || props.disabled === true}
                      {...(isActive ? { 'aria-current': 'true' as const } : {})}
                      onClick={() => props.onSwitch(sibling.headMessageId)}
                      data-testid="branch-point-item"
                      data-branch-head={sibling.headMessageId}
                    >
                      <span className="branch-point-ordinal" aria-label={`Branch ${String(index + 1)}`}>
                        {index + 1}
                      </span>
                      <span className="branch-point-text">
                        <div className="branch-point-tags">
                          {isReworded ? (
                            <span className="branch-point-tag branch-point-tag--reworded">
                              {isZh ? '修改提问' : 'Reworded'}
                            </span>
                          ) : null}
                          {sibling.responseStatus === 'error' ? (
                            <span className="branch-point-tag branch-point-tag--error">
                              {isZh ? '生成失败' : 'Failed'}
                            </span>
                          ) : null}
                          {isActive ? (
                            <span className="branch-point-tag branch-point-tag--active">
                              {isZh ? '当前活跃' : 'Active'}
                            </span>
                          ) : null}
                        </div>
                        <span className="branch-point-preview">{primaryText}</span>
                        {showContinuation ? (
                          <span className="branch-point-leaf muted">
                            {isZh ? `↳ 延伸至：${sibling.leafPreview}` : `↳ Continuation: ${sibling.leafPreview}`}
                          </span>
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
        );
      })}
    </div>
  );
}
