import { useState, type ReactElement, type ReactNode } from 'react';
import {
  extractUserFacingBody,
  readPlanActionMarker,
  type ConfiguredChatModel,
  type ModelRef,
} from '@piwin/contracts';
import { Icon } from '../icons.js';
import { formatClock } from '../host/host-bridge.js';
import type { InkstoneHost } from '../host/inkstone-host-context.js';
import type { SessionLiveState } from '../host/use-session-live-state.js';
import type { SessionQueueState } from '../host/use-session-queue.js';
import type { SessionWalkthroughs } from '../host/use-session-walkthroughs.js';
import { useCopyText } from '../use-copy-text.js';
import { PermissionGateCard, type PermissionScope } from './PermissionGateCard.js';
import { QuestionCard } from './QuestionCard.js';
import { TurnBlock } from './TurnBlock.js';
import { buildTranscriptEntries, type TranscriptEntry, type TurnView } from './turn-model.js';
import { retryTurn } from '../host/turn-retry.js';

export function TranscriptView({
  host,
  live,
  queue,
  walkthroughs,
  onResolvePermission,
  onOpenPermissionDetail,
  onOpenSession,
  onOpenChanges,
  onToast,
}: {
  host: InkstoneHost;
  live: SessionLiveState;
  queue: SessionQueueState;
  walkthroughs: SessionWalkthroughs;
  onResolvePermission: (decision: 'allow' | 'deny', scope: PermissionScope) => void;
  onOpenPermissionDetail: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenChanges: () => void;
  onToast: (message: string) => void;
}): ReactElement {
  const copyText = useCopyText();
  const [retryConfirm, setRetryConfirm] = useState<{ turnId: string; files: string[] } | undefined>();
  const activeRunId = host.activeRunId;

  const retry = (turn: TurnView, options: { keepPrevious: boolean; confirm: boolean }): void => {
    const client = host.client;
    const sessionId = host.activeSessionId;
    if (client === undefined || sessionId === undefined || turn.userMessage === undefined) return;
    setRetryConfirm(undefined);
    void retryTurn(client, {
      sessionId,
      userMessage: turn.userMessage,
      keepPreviousAttempt: options.keepPrevious,
      confirm: options.confirm,
    }).then((result) => {
      if (result.kind === 'needs-confirm') setRetryConfirm({ turnId: turn.id, files: result.files });
      else if (result.kind === 'failed') onToast(result.message);
      else {
        onToast(options.keepPrevious ? '正在重新回答 · 上一版保留' : '正在重试这一轮');
        // The Host moved the active leaf; re-read the active path so the
        // replaced attempt leaves the screen and the new run is followed.
        void host.handleSelectSession(sessionId);
      }
    });
  };
  const entries = buildTranscriptEntries(host.messages, {
    activeRunId,
    awaitingResponse: activeRunId !== undefined,
    queuedUserMessageIds: new Set(queue.queued.map((record) => record.userMessageId)),
  });

  const permission =
    host.permissionRequest !== undefined && host.permissionRequest.sessionId === host.activeSessionId
      ? host.permissionRequest
      : undefined;
  const gate: ReactNode =
    permission !== undefined ? (
      <PermissionGateCard
        key={permission.requestId}
        request={permission}
        resolving={host.isResolvingPermission}
        onResolve={onResolvePermission}
        onOpenDetail={onOpenPermissionDetail}
      />
    ) : live.extensionUi !== undefined ? (
      <QuestionCard key={live.extensionUi.requestId} prompt={live.extensionUi} onAnswer={live.resolveExtensionUi} />
    ) : null;

  const gateTurnIndex = gate === null ? -1 : findGateTurn(entries, permission?.runId ?? activeRunId);
  const lastTurnIndex = findLastIndex(entries, (entry) => entry.kind === 'turn');

  return (
    <>
      {entries.map((entry, index) => {
        if (entry.kind === 'user') {
          return <UserCard key={entry.id} entry={entry} />;
        }
        if (entry.kind === 'note') {
          return (
            <div className="cap" key={entry.id}>
              <i />
              {entry.text}
            </div>
          );
        }
        const turn = entry.turn;
        const answerId = turn.prose?.messageId;
        const walkthrough = answerId !== undefined ? walkthroughs.byMessageId.get(answerId) : undefined;
        // Retry needs the anchoring user row and an idle session.
        const retryable =
          turn.userMessage !== undefined &&
          activeRunId === undefined &&
          (turn.status === 'failed' || turn.status === 'cancelled' || (turn.status === 'done' && index === lastTurnIndex));
        const canAskWalkthrough =
          walkthroughs.canGenerate && answerId !== undefined && turn.status === 'done' && index === lastTurnIndex;
        return (
          <TurnBlock
            key={entry.id}
            turn={turn}
            modelLabel={labelForModel(turn.model, host.configuredModels)}
            readOutput={live.readToolOutput}
            inlineGate={index === gateTurnIndex ? gate : null}
            changes={turn.runId !== undefined ? live.changesByRunId.get(turn.runId) : undefined}
            showActions={index === lastTurnIndex && turn.status !== 'running'}
            onCopy={(text) => {
              void copyText(text);
            }}
            onOpenSession={onOpenSession}
            onOpenChanges={onOpenChanges}
            walkthrough={walkthrough}
            onRetry={retryable ? (options) => retry(turn, options) : undefined}
            retryConfirmFiles={retryConfirm?.turnId === turn.id ? retryConfirm.files : undefined}
            onCancelRetry={() => setRetryConfirm(undefined)}
            onGenerateWalkthrough={
              canAskWalkthrough
                ? () => {
                    void walkthroughs
                      .generate(answerId, turn.runId)
                      .then((error) => onToast(error ?? '已请求 Host 生成走查报告'));
                  }
                : undefined
            }
          />
        );
      })}
      {gate !== null && gateTurnIndex === -1 ? <div className="thread">{gate}</div> : null}
      {entries.length === 0 ? (
        <div className="context-note">新的会话 · 以当前项目和模型开始</div>
      ) : null}
    </>
  );
}

function UserCard({ entry }: { entry: Extract<TranscriptEntry, { kind: 'user' }> }): ReactElement | null {
  const planAction = readPlanActionMarker(entry.text);
  if (planAction !== undefined) {
    // A plan handoff is a Host directive the user approved, not typed words.
    return (
      <div className="plan-action">
        <Icon name="list" />
        <span>{planAction.kind === 'verify' ? '验证计划' : '执行计划'}</span>
        <b>{planAction.title}</b>
        <time>{formatClock(entry.createdAt)}</time>
      </div>
    );
  }
  const text = extractUserFacingBody(entry.text);
  if (text.length === 0 && entry.attachments.length === 0) {
    return null;
  }
  return (
    <div className="user-message">
      {text}
      <time className="user-time">{formatClock(entry.createdAt)}</time>
      {entry.attachments.map((attachment) => (
        <span key={attachment.id} className="pill" style={{ marginTop: 9, display: 'inline-flex' }}>
          <Icon name={attachment.mimeType.startsWith('image/') ? 'image' : 'file'} />
          {attachment.name ?? '附件'}
        </span>
      ))}
    </div>
  );
}

/** The gate belongs to the run that asked; fall back to the live (last) turn. */
function findGateTurn(entries: TranscriptEntry[], runId: string | undefined): number {
  if (runId !== undefined) {
    const byRun = findLastIndex(entries, (entry) => entry.kind === 'turn' && entry.turn.runId === runId);
    if (byRun !== -1) return byRun;
  }
  return findLastIndex(entries, (entry) => entry.kind === 'turn' && entry.turn.status === 'running');
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) return index;
  }
  return -1;
}

/** Turn signature stays pinned to the model that generated it, not the composer pick. */
function labelForModel(model: ModelRef | undefined, configured: readonly ConfiguredChatModel[]): string {
  if (model === undefined) {
    return 'piwin';
  }
  const match = configured.find(
    (item) => item.providerId === model.providerId && item.modelId === model.modelId,
  );
  // Never guess a marketing name from the id; the Host label or the raw id is the truth.
  return match?.label?.trim() || model.modelId;
}
