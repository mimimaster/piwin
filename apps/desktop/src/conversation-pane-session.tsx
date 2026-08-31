import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { IconButton, TextArea } from '@piwin/ui-kit';
import {
  formatError,
  parseSessionContextSnapshot,
  type ExecutionRunRecord,
  type HostServerMessage,
  type ModelRef,
  type SessionResumeData,
  type SessionScope,
  type SessionTranscriptMessage,
  type ThemeManifest,
} from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer.js';
import {
  isChatCompactPendingOccupancy,
  selectContextRingView,
} from './context-telemetry-selector.js';
import { ComposerContextUsageControl } from './composer-context-controls.js';
import type { HostClient } from './host-client.js';
import { createGestureIdempotencyKey } from './gesture-idempotency.js';
import {
  foregroundMismatchNotice,
  readForegroundProblem,
  requestPromptWithForeground,
} from './prompt-foreground.js';
import { ConversationPaneTranscript } from './conversation-pane-transcript.js';
import { createStreamEventBuffer } from './stream-event-buffer.js';
import { IconSend, IconStop } from './shell-icons.js';

import { MediaPreviewReadProvider } from './media-preview-read-context.js';
import type { MediaPreviewReader } from './transcript-media-preview.js';
import type { ArtifactCanvasTarget } from './artifact-canvas-model.js';
import type { DocumentOpenInput } from './tool-call-card.js';

type PaneResumeData = Omit<SessionResumeData, 'scope'> & {
  scope?: SessionScope | 'general' | 'project' | 'unknown';
  contextUsage?: SessionResumeData['contextUsage'];
};

export type ConversationPaneSessionProps = {
  sessionId: string;
  hostClient: HostClient;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  artifactPreviewEnabled: boolean;
  readMedia: MediaPreviewReader | null;
  locale: 'zh-CN' | 'en';
  onNameChange?: (name: string) => void;
  onSessionDeleted?: () => void;
  onOpenDocument?: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  fileBrowseRoot?: string | null;
};

function isGeneralScope(scope: PaneResumeData['scope']): boolean {
  return (
    scope === undefined ||
    scope === 'general' ||
    (typeof scope === 'object' && scope.kind === 'general')
  );
}

function readRun(responseData: unknown): ExecutionRunRecord | null {
  if (responseData === null || typeof responseData !== 'object') return null;
  const run = (responseData as { run?: unknown }).run;
  if (run === null || typeof run !== 'object') return null;
  const candidate = run as Partial<ExecutionRunRecord>;
  return typeof candidate.runId === 'string' && typeof candidate.sessionId === 'string'
    ? (candidate as ExecutionRunRecord)
    : null;
}

function messageBelongsToSession(message: HostServerMessage, sessionId: string): boolean {
  if ('sessionId' in message && typeof message.sessionId === 'string') {
    return message.sessionId === sessionId;
  }
  if (
    (message.type === 'run/updated' || message.type === 'run/terminal') &&
    message.run.sessionId
  ) {
    return message.run.sessionId === sessionId;
  }
  return false;
}

export function ConversationPaneSession(props: ConversationPaneSessionProps): ReactElement {
  const [state, dispatch] = useReducer(chatUiReducer, props.sessionId, (sessionId) =>
    chatUiReducer(createInitialChatUiState(), {
      type: 'session/set',
      sessionId,
      awaitTranscript: true,
    }),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const [composer, setComposer] = useState('');
  const [model, setModel] = useState<ModelRef | null>(null);
  const [busy, setBusy] = useState(false);
  const onNameChangeRef = useRef(props.onNameChange);
  const onSessionDeletedRef = useRef(props.onSessionDeleted);

  useEffect(() => {
    onNameChangeRef.current = props.onNameChange;
    onSessionDeletedRef.current = props.onSessionDeleted;
  }, [props.onNameChange, props.onSessionDeleted]);

  const hydrateForegroundRun = useCallback(
    async (isCancelled?: () => boolean): Promise<void> => {
      if (isCancelled?.()) return;
      dispatch({ type: 'foreground/admission', admission: 'reconciling' });
      const runIdAtStart = stateRef.current.activeRunId;
      try {
        const response = await props.hostClient.request({
          type: 'session/foreground-run',
          sessionId: props.sessionId,
        });
        if (isCancelled?.()) return;
        if (!response.success) {
          dispatch({ type: 'foreground/admission', admission: 'unknown' });
          return;
        }
        const run = readRun(response.data);
        if (run) {
          dispatch({ type: 'run/updated', run });
        } else if (runIdAtStart !== null && stateRef.current.activeRunId === runIdAtStart) {
          // A foreground query that returns no Run is authoritative. Pull the
          // durable tail before clearing the optimistic live projection so a
          // missed terminal push cannot leave the pane spinning or hide the
          // final assistant text.
          const messagesResponse = await props.hostClient.request({
            type: 'session/messages',
            sessionId: props.sessionId,
          });
          if (isCancelled?.()) return;
          if (messagesResponse.success) {
            const data = messagesResponse.data as
              { messages?: SessionTranscriptMessage[] } | undefined;
            if (Array.isArray(data?.messages)) {
              dispatch({
                type: 'session/load-messages',
                sessionId: props.sessionId,
                messages: data.messages,
              });
            }
          }
          dispatch({ type: 'run/stale-clear', sessionId: props.sessionId });
        }
        dispatch({ type: 'foreground/admission', admission: 'ready' });
      } catch {
        dispatch({ type: 'foreground/admission', admission: 'unknown' });
      }
    },
    [props.hostClient, props.sessionId],
  );

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'host/status', ready: props.hostClient.isReady(), mock: false });
    setComposer('');
    setModel(null);
    void (async () => {
      try {
        const statusResponse = await props.hostClient.request({ type: 'host/status' });
        if (!cancelled && statusResponse.success) {
          const capabilities = (statusResponse.data as { capabilities?: { contextTelemetryVersion?: 1 } } | undefined)
            ?.capabilities;
          dispatch({
            type: 'context-telemetry/capability',
            supported: capabilities?.contextTelemetryVersion === 1,
          });
        }
        const response = await props.hostClient.request({
          type: 'session/resume',
          sessionId: props.sessionId,
        });
        if (!response.success) {
          if (cancelled) return;
          if (response.problem?.code === 'session-not-found') {
            onSessionDeletedRef.current?.();
            return;
          }
          dispatch({ type: 'context-telemetry/invalidate', sessionId: props.sessionId });
          dispatch({ type: 'error', message: response.error });
          return;
        }
        if (cancelled) return;
        const data = response.data as PaneResumeData;
        if (!isGeneralScope(data.scope)) {
          dispatch({
            type: 'error',
            message:
              props.locale === 'zh-CN'
                ? '多窗格只能打开 Chat 会话。'
                : 'Multi-pane can only open Chat conversations.',
          });
          return;
        }
        dispatch({
          type: 'session/load-messages',
          sessionId: props.sessionId,
          messages: data.messages,
          ...(data.transcriptPage ? { transcriptPage: data.transcriptPage } : {}),
          ...(data.outline ? { outline: data.outline } : {}),
          ...(data.contextUsage !== undefined ? { contextUsage: data.contextUsage } : {}),
          live: data.live,
        });
        const snapshot = parseSessionContextSnapshot(data.contextSnapshot);
        if (snapshot) {
          dispatch({
            type: 'context-telemetry/snapshot',
            snapshot,
            source: 'hydrate',
          });
        }
        if ('lastRequestUsage' in data) {
          dispatch({
            type: 'context-telemetry/last-request',
            sessionId: props.sessionId,
            usage: data.lastRequestUsage ?? null,
          });
        }
        setModel(data.model ?? null);
        if (data.name) onNameChangeRef.current?.(data.name);
        await hydrateForegroundRun(() => cancelled);
      } catch (error) {
        if (cancelled) return;
        dispatch({ type: 'error', message: formatError(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateForegroundRun, props.hostClient, props.locale, props.sessionId]);

  useEffect(() => {
    const streamEventBuffer = createStreamEventBuffer({ dispatch });
    const unsubscribe = props.hostClient.subscribe((message) => {
      if (message.type === 'hydration') {
        streamEventBuffer.reset();
        const messages = message.snapshot.messagesBySession[props.sessionId];
        if (messages) {
          dispatch({
            type: 'session/load-messages',
            sessionId: props.sessionId,
            messages: messages as SessionTranscriptMessage[],
          });
        }
        return;
      }
      if (message.type === 'host/status') {
        dispatch({ type: 'host/status', ready: message.ready, mock: message.mock });
        if (message.ready) void hydrateForegroundRun();
        return;
      }
      if (!messageBelongsToSession(message, props.sessionId)) return;
      if (message.type === 'session/context-updated') {
        const snapshot = parseSessionContextSnapshot(message.snapshot);
        if (snapshot) {
          dispatch({
            type: 'context-telemetry/snapshot',
            snapshot,
            source: 'live',
          });
        }
      } else if (message.type === 'event') {
        streamEventBuffer.push(message.sessionId, message.event, message.envelope);
      } else if (message.type === 'run/updated') {
        streamEventBuffer.pushAction(message.run.sessionId, {
          type: 'run/updated',
          run: message.run,
        });
      } else if (message.type === 'run/terminal') {
        streamEventBuffer.pushAction(message.run.sessionId, {
          type: 'run/terminal',
          run: message.run,
        });
      } else if (message.type === 'transcript/append') {
        dispatch({
          type: 'transcript/append',
          sessionId: message.sessionId,
          message: message.message,
        });
      } else if (message.type === 'reply-writer/updated') {
        dispatch({
          type: 'reply-writer/updated',
          sessionId: message.sessionId,
          messageId: message.messageId,
          status: message.status,
          ...(message.model ? { model: message.model } : {}),
          ...(message.language ? { language: message.language } : {}),
        });
      } else if (message.type === 'session/name-updated') {
        onNameChangeRef.current?.(message.name);
      } else if (message.type === 'session/index-updated' && message.op === 'deleted') {
        onSessionDeletedRef.current?.();
      }
    });
    return () => {
      unsubscribe();
      streamEventBuffer.dispose();
    };
  }, [hydrateForegroundRun, props.hostClient, props.sessionId]);

  async function handleSend(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    const text = composer.trim();
    if (!text || busy) return;
    const clientMessageId = crypto.randomUUID();
    setComposer('');
    setBusy(true);
    if (state.streaming) {
      const instructionId = crypto.randomUUID();
      dispatch({
        type: 'user/steer',
        text,
        clientMessageId,
        instructionId,
        ...(state.activeRunId ? { targetRunId: state.activeRunId } : {}),
      });
      try {
        const response = await props.hostClient.request({
          type: 'session/steer',
          sessionId: props.sessionId,
          message: text,
          clientMessageId,
          ...(state.activeRunId ? { runId: state.activeRunId } : {}),
        });
        if (!response.success) {
          dispatch({ type: 'user/send-rollback', clientMessageId });
          dispatch({ type: 'error', message: response.error });
          setComposer(text);
        }
      } catch (error) {
        dispatch({ type: 'user/send-rollback', clientMessageId });
        dispatch({ type: 'error', message: formatError(error) });
        setComposer(text);
      } finally {
        setBusy(false);
      }
      return;
    }
    dispatch({
      type: 'user/send',
      text,
      clientMessageId,
      ...(model ? { model } : {}),
    });
    try {
      const response = await requestPromptWithForeground({
        request: (command, options) => props.hostClient.request(command, options),
        sessionId: props.sessionId,
        input: {
          text,
          clientMessageId,
          ...(model ? { model } : {}),
        },
        allowReplaceConfirm: false,
        createIdempotencyKey: createGestureIdempotencyKey,
        remoteForegroundAdmission: props.hostClient.supportsForegroundAdmission(),
      });
      if (!response.success) {
        dispatch({ type: 'user/send-rollback', clientMessageId });
        const problem = readForegroundProblem(response);
        dispatch({
          type: 'error',
          message: problem ? foregroundMismatchNotice(problem, props.locale) : response.error,
        });
        setComposer(text);
        return;
      }
      const run = readRun(response.data);
      const runId = run?.runId ?? (response.data as { runId?: string } | undefined)?.runId;
      if (typeof runId === 'string') dispatch({ type: 'run/accepted', runId });
    } catch (error) {
      dispatch({ type: 'user/send-rollback', clientMessageId });
      dispatch({ type: 'error', message: formatError(error) });
      setComposer(text);
    } finally {
      setBusy(false);
    }
  }

  async function handleStop(): Promise<void> {
    dispatch({ type: 'run/aborting' });
    try {
      let runId = state.activeRunId;
      if (!runId) {
        const response = await props.hostClient.request({
          type: 'session/foreground-run',
          sessionId: props.sessionId,
        });
        runId = response.success ? (readRun(response.data)?.runId ?? null) : null;
      }
      if (!runId) {
        dispatch({ type: 'run/stale-clear', sessionId: props.sessionId });
        return;
      }
      const response = await props.hostClient.request(
        { type: 'session/abort', sessionId: props.sessionId, runId },
        { idempotencyKey: createGestureIdempotencyKey() },
      );
      if (!response.success) dispatch({ type: 'run/abort-failed' });
    } catch (error) {
      dispatch({ type: 'run/abort-failed' });
      dispatch({ type: 'error', message: formatError(error) });
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSend();
    }
  }

  const canSend = composer.trim().length > 0 && !busy;
  const contextRingView = selectContextRingView({
    telemetry: state.contextTelemetry,
    locale: props.locale,
    ...(state.compacting ? { compacting: true } : {}),
    ...(isChatCompactPendingOccupancy(state) ? { compactPendingOccupancy: true } : {}),
  });
  return (
    <MediaPreviewReadProvider sessionId={props.sessionId} readMedia={props.readMedia}>
      <div
        className="conversation-pane-session"
        data-testid="conversation-pane-session"
        data-awaiting-transcript={state.awaitingTranscript ? 'true' : 'false'}
        data-message-count={state.messages.length}
        data-streaming={state.streaming ? 'true' : 'false'}
        data-context-ring={contextRingView.visible ? 'visible' : 'hidden'}
      >
        <ConversationPaneTranscript
          sessionId={props.sessionId}
          state={state}
          activeTheme={props.activeTheme}
          artifactThemeKey={props.artifactThemeKey}
          artifactPreviewEnabled={props.artifactPreviewEnabled}
          locale={props.locale}
          livePromptModel={model}
          {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
          {...(props.onOpenArtifactCanvas
            ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
            : {})}
          {...(props.fileBrowseRoot !== undefined
            ? { fileBrowseRoot: props.fileBrowseRoot }
            : {})}
        />
        {state.error ? (
          <div className="conversation-pane-error" role="alert">
            <span>{state.error}</span>
            <button type="button" onClick={() => dispatch({ type: 'error/clear' })}>
              {props.locale === 'zh-CN' ? '关闭' : 'Dismiss'}
            </button>
          </div>
        ) : null}
        <form className="conversation-pane-composer" onSubmit={(event) => void handleSend(event)}>
          <TextArea
            value={composer}
            onChange={setComposer}
            rows={2}
            disabled={!state.hostReady}
            placeholder={props.locale === 'zh-CN' ? '输入消息…' : 'Message…'}
            testId="conversation-pane-composer"
            nativeProps={{
              'aria-label': props.locale === 'zh-CN' ? 'Chat 输入框' : 'Chat composer',
              onKeyDown: handleComposerKeyDown,
            }}
          />
          <ComposerContextUsageControl view={contextRingView} />
          {state.streaming && !composer.trim() ? (
            <IconButton
              label={props.locale === 'zh-CN' ? '停止生成' : 'Stop response'}
              className="conversation-pane-send is-stop"
              onClick={() => void handleStop()}
            >
              <IconStop width={15} height={15} />
            </IconButton>
          ) : (
            <IconButton
              label={
                state.streaming
                  ? props.locale === 'zh-CN'
                    ? '调整当前任务'
                    : 'Steer current run'
                  : props.locale === 'zh-CN'
                    ? '发送消息'
                    : 'Send message'
              }
              className="conversation-pane-send"
              type="submit"
              disabled={!canSend}
            >
              <IconSend width={16} height={16} />
            </IconButton>
          )}
        </form>
        {!state.hostReady ? (
          <div className="conversation-pane-connection" role="status">
            {props.locale === 'zh-CN' ? '正在等待 Host 连接…' : 'Waiting for Host connection…'}
          </div>
        ) : null}
      </div>
    </MediaPreviewReadProvider>
  );
}
