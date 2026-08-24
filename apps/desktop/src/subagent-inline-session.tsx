/**
 * Inline subagent session panel (accordion body).
 *
 * Expands in place beneath the transcript anchor (invocation block or activity
 * card) that owns the current inspector selection: a read-only live transcript
 * with the same tool-call presentation as the parent thread, plus explicit
 * retained-worktree actions. Deliberately has no follow-up composer — the
 * parent agent owns the conversation with its subagents; the user observes,
 * applies/discards worktree changes, or promotes to the full session view.
 * Collapsing never aborts the child.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Button, ConfirmDialog, IconButton } from '@piwin/ui-kit';
import type { SubagentIntegrationStatus } from '@piwin/contracts';
import { SubagentSessionTranscript } from './subagent-session-transcript';
import { useDesktopLocale } from './desktop-locale-context';
import {
  useSubagentInspectorPanel,
  useSubagentInspectorToggle,
  type SubagentWorktreeAction,
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

function worktreeStatusLabel(
  status: SubagentIntegrationStatus | undefined,
  isChinese: boolean,
): string {
  if (status === 'conflict') {
    return isChinese ? '应用时发生冲突，工作树已保留' : 'Apply conflicted; worktree retained';
  }
  if (status === 'failed') {
    return isChinese ? '应用失败，工作树已保留' : 'Apply failed; worktree retained';
  }
  return isChinese ? '修改尚未应用，工作树已保留' : 'Changes are unapplied and retained';
}

export function SubagentInlineSession(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const toggle = useSubagentInspectorToggle();
  const panel = useSubagentInspectorPanel();
  const childSessionId = toggle?.selection?.childSessionId ?? null;

  const [worktreeBusy, setWorktreeBusy] = useState<SubagentWorktreeAction | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [worktreeNotice, setWorktreeNotice] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  useEffect(() => {
    setWorktreeBusy(null);
    setWorktreeError(null);
    setWorktreeNotice(null);
    setDiscardConfirmOpen(false);
  }, [childSessionId]);

  if (childSessionId === null || panel === null) {
    return null;
  }

  const isLive = panel.liveTail?.streaming === true;
  const active = panel.status === 'queued' || panel.status === 'running' || isLive;
  const integrationStatus = panel.child?.subagentIntegrationStatus;
  const identityRole = panel.invocation?.role ?? panel.child?.subagentRole;
  const identityProfileId = panel.invocation?.profileId ?? panel.child?.subagentProfileId;
  const identityModel = panel.invocation?.model ?? panel.child?.subagentModel;
  const retainedWorktreeAvailable =
    panel.child?.subagentMode === 'worktree' &&
    Boolean(panel.child.worktreePath) &&
    (integrationStatus === 'retained' ||
      integrationStatus === 'conflict' ||
      integrationStatus === 'failed');

  const runWorktreeAction = async (action: SubagentWorktreeAction): Promise<void> => {
    if (active || worktreeBusy) return;
    setWorktreeBusy(action);
    setWorktreeError(null);
    setWorktreeNotice(null);
    try {
      await panel.onWorktreeAction(childSessionId, action);
      setWorktreeNotice(
        action === 'apply'
          ? isChinese
            ? '已请求应用修改'
            : 'Changes applied'
          : action === 'discard'
            ? isChinese
              ? '已丢弃工作树'
              : 'Worktree discarded'
            : isChinese
              ? '工作树将继续保留'
              : 'Worktree retained',
      );
      if (action === 'discard') setDiscardConfirmOpen(false);
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorktreeBusy(null);
    }
  };

  return (
    <section
      className="subagent-inline-session"
      data-testid="subagent-inline-session"
      data-status={panel.status}
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
        artifactPreviewEnabled={panel.artifactPreviewEnabled}
        {...(panel.artifactMaxBytes !== undefined
          ? { artifactMaxBytes: panel.artifactMaxBytes }
          : {})}
        {...(panel.onPermission ? { onPermission: panel.onPermission } : {})}
        {...(panel.showThinking !== undefined ? { showThinking: panel.showThinking } : {})}
      />
      {retainedWorktreeAvailable && !active ? (
        <footer className="subagent-worktree-actions" data-testid="subagent-worktree-actions">
          <div className="subagent-worktree-copy">
            <strong>{isChinese ? '隔离工作树修改' : 'Isolated worktree changes'}</strong>
            <span className="muted">{worktreeStatusLabel(integrationStatus, isChinese)}</span>
          </div>
          <div className="subagent-worktree-buttons">
            <Button
              variant="primary"
              size="compact"
              disabled={worktreeBusy !== null}
              data-testid="subagent-worktree-apply"
              onClick={() => void runWorktreeAction('apply')}
            >
              {worktreeBusy === 'apply'
                ? isChinese
                  ? '应用中…'
                  : 'Applying…'
                : isChinese
                  ? '应用修改'
                  : 'Apply changes'}
            </Button>
            <Button
              size="compact"
              disabled={worktreeBusy !== null}
              data-testid="subagent-worktree-retain"
              onClick={() => void runWorktreeAction('retain')}
            >
              {isChinese ? '保留' : 'Keep'}
            </Button>
            <Button
              variant="danger"
              size="compact"
              disabled={worktreeBusy !== null}
              data-testid="subagent-worktree-discard"
              onClick={() => setDiscardConfirmOpen(true)}
            >
              {isChinese ? '丢弃' : 'Discard'}
            </Button>
          </div>
          {worktreeError ? (
            <span className="subagent-worktree-feedback tone-error" role="alert">
              {worktreeError}
            </span>
          ) : worktreeNotice ? (
            <span className="subagent-worktree-feedback muted" role="status">
              {worktreeNotice}
            </span>
          ) : null}
        </footer>
      ) : null}
      <ConfirmDialog
        open={discardConfirmOpen}
        onOpenChange={setDiscardConfirmOpen}
        title={isChinese ? '丢弃子代理工作树？' : 'Discard subagent worktree?'}
        description={
          isChinese
            ? '这会永久删除隔离工作树及其尚未应用的修改，无法恢复。'
            : 'This permanently removes the isolated worktree and its unapplied changes.'
        }
        affectedObject={panel.child?.worktreePath}
        confirmLabel={isChinese ? '确认丢弃' : 'Discard'}
        cancelLabel={isChinese ? '取消' : 'Cancel'}
        tone="danger"
        busy={worktreeBusy === 'discard'}
        error={worktreeError}
        onConfirm={() => void runWorktreeAction('discard')}
        testId="subagent-worktree-discard-confirm"
      />
    </section>
  );
}
