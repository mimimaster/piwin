/**
 * Subagent session inspector with live transcript, constrained continuation,
 * and explicit retained-worktree actions. Closing it never aborts the child.
 */
import { useEffect, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Button, ConfirmDialog, Dialog, IconButton, TextArea } from '@piwin/ui-kit';
import type { SessionSummary, SubagentIntegrationStatus } from '@piwin/contracts';
import type { ChatMessageUi, SubagentStreamState } from './chat-reducer';
import type { ActiveSubagentStatus, SubagentInspectorSelection } from './subagent-activity-model';
import {
  SubagentSessionTranscript,
  type SubagentSessionTranscriptProps,
} from './subagent-session-transcript';
import { useDesktopLocale } from './desktop-locale-context';
import { IconClose } from './shell-icons';

export type SubagentSessionDialogProps = {
  open: boolean;
  selection: SubagentInspectorSelection | null;
  child?: SessionSummary;
  status: ActiveSubagentStatus;
  messages: ChatMessageUi[];
  liveTail: SubagentStreamState | null;
  loading: boolean;
  error: string | null;
  /** Whether child-session thinking should be shown in the inspector. */
  showThinking?: boolean;
  onOpenChange: (open: boolean) => void;
  /** Promote the preview to the existing full session view. */
  onOpenFullSession: (sessionId: string) => void;
  onRetry: () => void;
  onContinue: (childSessionId: string, text: string) => Promise<void>;
  onWorktreeAction: (
    childSessionId: string,
    action: 'apply' | 'retain' | 'discard',
  ) => Promise<void>;
} & Pick<
  SubagentSessionTranscriptProps,
  | 'projectPath'
  | 'request'
  | 'filesChangedRequest'
  | 'onOpenFile'
  | 'onOpenDocument'
  | 'onArtifactAction'
  | 'onOpenArtifactCanvas'
  | 'artifactPreviewEnabled'
  | 'artifactMaxBytes'
  | 'onPermission'
>;

const STATUS_LABEL: Record<ActiveSubagentStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function SubagentSessionDialog(props: SubagentSessionDialogProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { selection, status } = props;
  const isLive = props.liveTail?.streaming === true;
  const [followUp, setFollowUp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [worktreeBusy, setWorktreeBusy] = useState<'apply' | 'retain' | 'discard' | null>(null);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [worktreeNotice, setWorktreeNotice] = useState<string | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  useEffect(() => {
    setFollowUp('');
    setSubmitError(null);
    setWorktreeBusy(null);
    setWorktreeError(null);
    setWorktreeNotice(null);
    setDiscardConfirmOpen(false);
  }, [selection?.childSessionId]);
  const active = status === 'queued' || status === 'running' || isLive;
  const integrationStatus = props.child?.subagentIntegrationStatus;
  const retainedWorktreeAvailable =
    props.child?.subagentMode === 'worktree' &&
    Boolean(props.child.worktreePath) &&
    (integrationStatus === 'retained' ||
      integrationStatus === 'conflict' ||
      integrationStatus === 'failed');
  const worktreeUnavailable =
    props.child?.subagentMode === 'worktree' &&
    !retainedWorktreeAvailable;
  const canContinue = !active && !worktreeUnavailable && !submitting;
  const submitFollowUp = async (): Promise<void> => {
    const text = followUp.trim();
    if (!selection || !text || !canContinue) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await props.onContinue(selection.childSessionId, text);
      setFollowUp('');
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };
  const handleFollowUpKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submitFollowUp();
  };
  const runWorktreeAction = async (
    action: 'apply' | 'retain' | 'discard',
  ): Promise<void> => {
    if (!selection || active || worktreeBusy) return;
    setWorktreeBusy(action);
    setWorktreeError(null);
    setWorktreeNotice(null);
    try {
      await props.onWorktreeAction(selection.childSessionId, action);
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
    <Dialog
      label={selection?.displayName ?? (isChinese ? '子代理会话' : 'Subagent session')}
      open={props.open}
      onOpenChange={props.onOpenChange}
      contentClassName="subagent-session-dialog-content"
      testId="subagent-session-dialog"
    >
      {selection !== null ? (
        <div className="subagent-session-dialog">
          <header className="subagent-session-dialog-header">
            <div className="subagent-session-dialog-heading">
              <span className={`subagent-session-state state-${status}`}>
                {STATUS_LABEL[status]}
              </span>
              <h2 className="subagent-session-title" title={selection.taskSummary}>
                {selection.taskSummary || selection.displayName}
              </h2>
              <span className="subagent-session-identity muted">
                {isChinese ? '子代理会话' : 'Subagent session'} · {selection.displayName}
                {props.child?.subagentProfileId
                  ? ` · ${props.child.subagentProfileId}`
                  : ''}
                {props.child?.subagentModel?.modelId
                  ? ` · ${props.child.subagentModel.modelId}`
                  : ''}
              </span>
            </div>
            <div className="subagent-session-actions">
              <Button
                variant="ghost"
                size="compact"
                data-testid="subagent-open-full-session"
                onClick={() => props.onOpenFullSession(selection.childSessionId)}
              >
                {isChinese ? '打开完整会话' : 'Open full session'} ↗
              </Button>
              <IconButton
                label={isChinese ? '关闭' : 'Close'}
                onClick={() => props.onOpenChange(false)}
              >
                <IconClose />
              </IconButton>
            </div>
          </header>
          <SubagentSessionTranscript
            historicalMessages={props.messages}
            stream={props.liveTail}
            loading={props.loading}
            error={props.error}
            onRetry={props.onRetry}
            locale={locale}
            childSessionId={selection.childSessionId}
            {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
            {...(props.request ? { request: props.request } : {})}
            {...(props.filesChangedRequest
              ? { filesChangedRequest: props.filesChangedRequest }
              : {})}
            {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}
            {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
            {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
            {...(props.onOpenArtifactCanvas
              ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
              : {})}
            {...(props.artifactPreviewEnabled ? { artifactPreviewEnabled: true } : {})}
            {...(props.artifactMaxBytes !== undefined
              ? { artifactMaxBytes: props.artifactMaxBytes }
              : {})}
            {...(props.onPermission ? { onPermission: props.onPermission } : {})}
            {...(props.showThinking !== undefined ? { showThinking: props.showThinking } : {})}
          />
          {retainedWorktreeAvailable && !active ? (
            <section className="subagent-worktree-actions" data-testid="subagent-worktree-actions">
              <div className="subagent-worktree-copy">
                <strong>{isChinese ? '隔离工作树修改' : 'Isolated worktree changes'}</strong>
                <span className="muted">
                  {worktreeStatusLabel(integrationStatus, isChinese)}
                </span>
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
            </section>
          ) : null}
          <div className="subagent-session-composer" data-testid="subagent-session-composer">
            <TextArea
              value={followUp}
              onChange={setFollowUp}
              rows={2}
              maxLength={20_000}
              disabled={!canContinue}
              placeholder={
                active
                  ? isChinese
                    ? '当前子任务完成后可继续追问'
                    : 'Continue after the current task finishes'
                  : worktreeUnavailable
                    ? isChinese
                      ? '工作树已处理，请新建隔离任务'
                      : 'Worktree is no longer retained; start a new isolated task'
                    : isChinese
                      ? '继续向子代理追问'
                      : 'Send follow-up with subagent'
              }
              error={submitError}
              testId="subagent-follow-up-input"
              nativeProps={{ onKeyDown: handleFollowUpKeyDown }}
            />
            <Button
              variant="primary"
              size="compact"
              disabled={!canContinue || followUp.trim().length === 0}
              data-testid="subagent-follow-up-send"
              onClick={() => void submitFollowUp()}
            >
              {isChinese ? '发送' : 'Send'}
            </Button>
          </div>
          <footer className="subagent-session-dialog-footer">
            <span className={`subagent-session-footer-status status-${status}`}>
              {isLive ? <span className="subagent-session-live-dot" aria-hidden="true" /> : null}
              {STATUS_LABEL[status]}
              {isLive ? (
                <span className="muted">
                  {isChinese ? '· 自动跟随输出' : '· auto-following output'}
                </span>
              ) : null}
            </span>
          </footer>
          <ConfirmDialog
            open={discardConfirmOpen}
            onOpenChange={setDiscardConfirmOpen}
            title={isChinese ? '丢弃子代理工作树？' : 'Discard subagent worktree?'}
            description={
              isChinese
                ? '这会永久删除隔离工作树及其尚未应用的修改，无法恢复。'
                : 'This permanently removes the isolated worktree and its unapplied changes.'
            }
            affectedObject={props.child?.worktreePath}
            confirmLabel={isChinese ? '确认丢弃' : 'Discard'}
            cancelLabel={isChinese ? '取消' : 'Cancel'}
            tone="danger"
            busy={worktreeBusy === 'discard'}
            error={worktreeError}
            onConfirm={() => void runWorktreeAction('discard')}
            testId="subagent-worktree-discard-confirm"
          />
        </div>
      ) : null}
    </Dialog>
  );
}

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
