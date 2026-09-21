/**
 * Inline subagent session panel (accordion body).
 *
 * Observation only: live transcript, identity chips, open-full-session.
 * Delivery is Host-owned on the parent turn — no standing apply/retain/discard bar.
 */
import { type ReactElement } from 'react';
import { Button, IconButton } from '@piwin/ui-kit';
import { SubagentSessionTranscript } from './subagent-session-transcript';
import { useDesktopLocale } from './desktop-locale-context';
import {
  useSubagentInspectorPanel,
  useSubagentInspectorToggle,
} from './subagent-inspector-context';
import type { ActiveSubagentStatus } from './subagent-activity-model';
import { SubagentIdentityChips } from './subagent-identity-chip';
import { IconChevronUp } from './shell-icons';

const STATUS_LABEL_EN: Record<ActiveSubagentStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const STATUS_LABEL_ZH: Record<ActiveSubagentStatus, string> = {
  queued: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function SubagentInlineSession(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const toggle = useSubagentInspectorToggle();
  const panel = useSubagentInspectorPanel();
  const childSessionId = toggle?.selection?.childSessionId ?? null;

  if (childSessionId === null || panel === null) {
    return null;
  }

  const isLive = panel.liveTail?.streaming === true;
  const identityRole = panel.invocation?.role ?? panel.child?.subagentRole;
  const identityProfileId = panel.invocation?.profileId ?? panel.child?.subagentProfileId;
  const identityModel = panel.invocation?.model ?? panel.child?.subagentModel;

  return (
    <section
      className="subagent-inline-session"
      data-testid="subagent-inline-session"
      data-status={panel.status}
      data-result-id={panel.child?.id ?? childSessionId}
      aria-label={isChinese ? '子代理会话' : 'Subagent session'}
    >
      <header className="subagent-inline-header">
        <span className={`subagent-session-state state-${panel.status}`}>
          {isLive ? <span className="subagent-session-live-dot" aria-hidden="true" /> : null}
          {(isChinese ? STATUS_LABEL_ZH : STATUS_LABEL_EN)[panel.status]}
        </span>
        <SubagentIdentityChips
          locale={locale}
          {...(identityRole ? { role: identityRole } : {})}
          {...(identityProfileId ? { profileId: identityProfileId } : {})}
          {...(identityModel ? { model: identityModel } : {})}
          {...(panel.modelOptions ? { modelOptions: panel.modelOptions } : {})}
        />
        <span className="subagent-inline-header-spacer" aria-hidden="true" />
        <Button
          variant="ghost"
          size="compact"
          data-testid="subagent-open-full-session"
          onClick={panel.onOpenFullSession}
        >
          {isChinese ? '打开完整会话' : 'Open full session'} ↗
        </Button>
        <IconButton
          label={isChinese ? '收起' : 'Collapse'}
          data-testid="subagent-inline-collapse"
          onClick={panel.onClose}
        >
          <IconChevronUp width={14} height={14} />
        </IconButton>
      </header>
      <SubagentSessionTranscript
        historicalMessages={panel.messages}
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
    </section>
  );
}
