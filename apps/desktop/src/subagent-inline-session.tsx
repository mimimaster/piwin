/**
 * Inline subagent session box (Inkstone proto-13), opened by clicking a row:
 *
 *   step N · 运行中
 *   what it is doing now / 已完成：conclusion / 失败：reason
 *   > N 次工具调用 · 保留最近 20 步   (toggles the recent steps)
 *   打开完整会话 →
 *
 * Observation only — delivery is Host-owned on the parent turn, so there is
 * no apply/retain/discard bar and no follow-up composer. Clicking the row
 * again folds the box. A pending child permission forces the steps open so
 * the approval gate is never hidden behind the fold.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { IconChevronRight } from './shell-icons';
import { SubagentSessionTranscript } from './subagent-session-transcript';
import { useDesktopLocale } from './desktop-locale-context';
import {
  useSubagentInspectorPanel,
  useSubagentInspectorToggle,
} from './subagent-inspector-context';
import {
  deriveSubagentInlineDetail,
  recentSubagentSteps,
  shouldShowSubagentSteps,
} from './subagent-inline-view';

export function SubagentInlineSession(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const toggle = useSubagentInspectorToggle();
  const panel = useSubagentInspectorPanel();
  const [stepsOpen, setStepsOpen] = useState(false);
  const messages = panel?.messages;
  const recentMessages = useMemo(() => recentSubagentSteps(messages ?? []), [messages]);
  const childSessionId = toggle?.selection?.childSessionId ?? null;

  if (childSessionId === null || panel === null) {
    return null;
  }

  const isLive = panel.liveTail?.streaming === true;
  const detail = deriveSubagentInlineDetail({
    status: panel.status,
    invocation: panel.invocation,
    child: panel.child,
    liveTail: panel.liveTail,
    locale,
  });
  const showSteps = shouldShowSubagentSteps({ userOpen: stepsOpen, liveTail: panel.liveTail });

  return (
    <section
      className="subagent-inline-session"
      data-testid="subagent-inline-session"
      data-status={panel.status}
      data-result-id={panel.child?.id ?? childSessionId}
      aria-label={isChinese ? '子代理会话' : 'Subagent session'}
    >
      <div className="subagent-inline-step" data-testid="subagent-inline-step">
        {isLive ? <span className="subagent-session-live-dot" aria-hidden="true" /> : null}
        {detail.stepLabel}
      </div>
      <p
        className="subagent-inline-conclusion"
        data-testid="subagent-inline-conclusion"
        data-tone={detail.tone}
      >
        {detail.conclusion}
      </p>
      <button
        type="button"
        className="subagent-inline-steps-toggle"
        data-testid="subagent-inline-steps-toggle"
        aria-expanded={showSteps}
        onClick={() => setStepsOpen((open) => !open)}
      >
        <IconChevronRight
          className="subagent-inline-steps-caret"
          width={11}
          height={11}
          aria-hidden="true"
        />
        {detail.toolCallsLabel ? `${detail.toolCallsLabel} · ` : null}
        {detail.retainedLabel}
      </button>
      {showSteps ? (
        <div className="subagent-inline-steps" data-testid="subagent-inline-steps">
          <SubagentSessionTranscript
            historicalMessages={recentMessages}
            stream={panel.liveTail}
            loading={panel.loading}
            error={panel.error}
            onRetry={panel.onRetry}
            locale={locale}
            childSessionId={childSessionId}
            {...(panel.projectPath !== undefined ? { projectPath: panel.projectPath } : {})}
            {...(panel.request ? { request: panel.request } : {})}
            {...(panel.filesChangedRequest
              ? { filesChangedRequest: panel.filesChangedRequest }
              : {})}
            {...(panel.onOpenFile ? { onOpenFile: panel.onOpenFile } : {})}
            {...(panel.onOpenDiff ? { onOpenDiff: panel.onOpenDiff } : {})}
            {...(panel.onOpenDocument ? { onOpenDocument: panel.onOpenDocument } : {})}
            {...(panel.onArtifactAction ? { onArtifactAction: panel.onArtifactAction } : {})}
            {...(panel.onOpenArtifactCanvas
              ? { onOpenArtifactCanvas: panel.onOpenArtifactCanvas }
              : {})}
            artifactInlineEnabled={panel.artifactInlineEnabled}
            artifactCanvasEnabled={panel.artifactCanvasEnabled ?? panel.artifactInlineEnabled}
            {...(panel.artifactMaxBytes !== undefined
              ? { artifactMaxBytes: panel.artifactMaxBytes }
              : {})}
            {...(panel.artifactBlockExternalScripts !== undefined
              ? { artifactBlockExternalScripts: panel.artifactBlockExternalScripts }
              : {})}
            {...(panel.artifactBlockExternalResources !== undefined
              ? { artifactBlockExternalResources: panel.artifactBlockExternalResources }
              : {})}
            {...(panel.onPermission ? { onPermission: panel.onPermission } : {})}
            {...(panel.showThinking !== undefined ? { showThinking: panel.showThinking } : {})}
          />
        </div>
      ) : null}
      <button
        type="button"
        className="subagent-inline-foot"
        data-testid="subagent-open-full-session"
        onClick={panel.onOpenFullSession}
      >
        {detail.openFullLabel}
      </button>
    </section>
  );
}
