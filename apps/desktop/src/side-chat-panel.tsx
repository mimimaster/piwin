/**
 * Side Chat panel — Host-backed persistent side chat (spec §10).
 *
 * Replaces the scratchpad. The panel:
 *  - Lists side chats for the active main session via `side-chat/list`.
 *  - Opens a new side chat via `side-chat/open` (inherits main-session context).
 *  - Sends prompts via `session/prompt` (read-only tool profile compiled at
 *    creation time; no UI-side gating needed).
 *  - Subscribes to `event` + `run/terminal` pushes filtered by side chat sessionId.
 *  - Offers handoff: insert side chat response into the main composer.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, RadialBellow } from '@piwin/ui-kit';
import { formatError } from '@piwin/contracts';
import type {
  AgentEvent,
  HostServerMessage,
  ModelRef,
  SessionSummary,
  SideChatOpenData,
  ThinkingLevel,
} from '@piwin/contracts';
import type { HostClient } from './host-client';
import {
  appendBoundedLiveText,
  STREAMING_TEXT_RETENTION_OPTIONS,
} from './chat-reducer';
import { ComposerCard } from './composer-card.js';
import { foregroundMismatchNotice, readForegroundProblem } from './prompt-foreground';
import { commitSessionComposerProfile } from './hooks/commit-session-composer-profile.js';
import { useComposerContextRefs } from './hooks/use-composer-context-refs.js';
import { useSessionComposerProfile } from './hooks/use-session-composer-profile.js';
import { abortSideChatRun, sendSideChatPrompt } from './side-chat-host-requests.js';
import { createGestureIdempotencyKey } from './gesture-idempotency.js';
import { useDesktopLocale } from './desktop-locale-context';
import { buildSideChatComposerProps } from './side-chat-composer-props.js';
import { SideChatEmptyState } from './side-chat-empty-state.js';
import { useRightPanelChrome } from './right-panel-chrome.js';
import {
  subscribeSideChatComposerSeed,
  takeSideChatComposerSeed,
  type SideChatComposerSeed,
} from './side-chat-composer-seed.js';
import {
  listSideChatTabs,
  SIDE_CHAT_DRAFT_TAB_ID,
  SideChatTabStrip,
} from './side-chat-tabs.js';
import { MarkdownView } from './MarkdownView.js';
import type { DesktopLocale } from './desktop-locale.js';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type SideChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
};

/** Bounded message history: the panel lives for the whole app session and
 * only clears on main-session switch, so appends must not grow unbounded. */
const MAX_SIDE_CHAT_MESSAGES = 200;

function appendBoundedSideChatMessage(
  current: SideChatMessage[],
  message: SideChatMessage,
): SideChatMessage[] {
  return [...current, message].slice(-MAX_SIDE_CHAT_MESSAGES);
}

function SideChatAssistantBody(props: {
  text: string;
  streaming: boolean;
  locale: DesktopLocale;
}): ReactElement {
  return (
    <MarkdownView
      text={props.text}
      renderingPhase={props.streaming ? 'streaming' : 'completed'}
      showStreamingCaret={props.streaming}
      locale={props.locale}
      artifactInlineEnabled={false}
    />
  );
}

export type SideChatPanelProps = {
  /** Active main session id (the source for side chats). */
  sessionId?: string | null;
  /** Host client for sending commands and subscribing to pushes. */
  hostClient: HostClient;
  /** Insert text into the main composer (handoff). */
  onInsertToMain?: (text: string) => void;
};

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function SideChatPanel(props: SideChatPanelProps): ReactElement {
  const { hostClient, sessionId } = props;
  const { locale } = useDesktopLocale();
  const panelChrome = useRightPanelChrome();
  const endRef = useRef<HTMLDivElement | null>(null);

  const [sideChats, setSideChats] = useState<SessionSummary[]>([]);
  const [activeSideChatId, setActiveSideChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SideChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantBuffer, setAssistantBuffer] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const [resumeModel, setResumeModel] = useState<ModelRef | null>(null);
  const [resumeThinkingLevel, setResumeThinkingLevel] = useState<ThinkingLevel | undefined>(
    undefined,
  );
  const composer = useSessionComposerProfile({
    hostClient,
    sessionId: activeSideChatId,
    ...(resumeModel ? { resumeModel } : {}),
    ...(resumeThinkingLevel !== undefined ? { resumeThinkingLevel } : {}),
  });
  const contextRefs = useComposerContextRefs();

  const refreshList = useCallback(async (): Promise<SessionSummary[]> => {
    if (!sessionId) {
      setSideChats([]);
      return [];
    }
    try {
      const response = await hostClient.request({
        type: 'side-chat/list',
        sourceSessionId: sessionId,
      });
      if (response.success) {
        const data = response.data as { sessions: SessionSummary[] } | undefined;
        const sessions = data?.sessions ?? [];
        setSideChats(sessions);
        return sessions;
      }
    } catch {
      // Non-fatal: list refresh is best-effort.
    }
    return [];
  }, [hostClient, sessionId]);

  const applyComposerSeed = useCallback(
    (seed: SideChatComposerSeed) => {
      if (seed.refs.length > 0) {
        contextRefs.replaceContextRefs(seed.refs);
      }
      if (!seed.sideChatSessionId) return;
      setActiveSideChatId(seed.sideChatSessionId);
      setMessages([]);
      setActiveRunId(null);
      setError(null);
      void refreshList();
      void hostClient
        .request({ type: 'session/resume', sessionId: seed.sideChatSessionId })
        .catch(() => undefined);
    },
    [contextRefs.replaceContextRefs, hostClient, refreshList],
  );

  useEffect(() => {
    const queued = takeSideChatComposerSeed();
    if (queued) applyComposerSeed(queued);
    return subscribeSideChatComposerSeed(applyComposerSeed);
  }, [applyComposerSeed]);

  useEffect(() => {
    let cancelled = false;
    setActiveSideChatId(null);
    setMessages([]);
    setActiveRunId(null);
    setResumeModel(null);
    setResumeThinkingLevel(undefined);
    void (async () => {
      const sessions = await refreshList();
      if (cancelled) return;
      const newest = sessions[0];
      if (!newest) return;
      await hydrateSideChat(newest);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshList]);

  // Subscribe to agent events for the active side chat.
  useEffect(() => {
    if (!activeSideChatId) return;

    const unsubscribe = hostClient.subscribe((message: HostServerMessage) => {
      if (message.type === 'event' && message.sessionId === activeSideChatId) {
        handleAgentEvent(message.event);
      } else if (message.type === 'run/updated' && message.run.sessionId === activeSideChatId) {
        setActiveRunId(message.run.runId);
      } else if (message.type === 'run/terminal' && message.run.sessionId === activeSideChatId) {
        setStreaming(false);
        setActiveRunId(null);
        // Flush any remaining assistant buffer.
        setAssistantBuffer((buffer) => {
          if (buffer) {
            const flushedMessage: SideChatMessage = {
              id: `${Date.now()}-a`,
              role: 'assistant',
              text: buffer,
              at: new Date().toISOString(),
            };
            setMessages((current) => appendBoundedSideChatMessage(current, flushedMessage));
            return '';
          }
          return buffer;
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [hostClient, activeSideChatId]);

  // Scroll to bottom on new messages.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, assistantBuffer]);

  function handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'message/start':
        setAssistantBuffer('');
        break;
      case 'message/text_delta':
        setAssistantBuffer((buffer) =>
          appendBoundedLiveText({ text: buffer }, event.delta, STREAMING_TEXT_RETENTION_OPTIONS)
            .text,
        );
        break;
      case 'message/text_snapshot':
        setAssistantBuffer(
          appendBoundedLiveText({ text: event.text }, '', STREAMING_TEXT_RETENTION_OPTIONS).text,
        );
        break;
      case 'message/end':
        setAssistantBuffer((buffer) => {
          if (buffer) {
            const assistantMessage: SideChatMessage = {
              id: `${Date.now()}-a`,
              role: 'assistant',
              text: buffer,
              at: new Date().toISOString(),
            };
            setMessages((current) => appendBoundedSideChatMessage(current, assistantMessage));
          }
          return '';
        });
        break;
      default:
        // Ignore tool/usage/permission events in the side chat panel for now.
        break;
    }
  }

  async function hydrateSideChat(chat: SessionSummary): Promise<void> {
    setActiveSideChatId(chat.id);
    setMessages([]);
    setActiveRunId(null);
    setError(null);
    setResumeModel(chat.model ?? null);
    setResumeThinkingLevel(chat.thinkingLevel);
    try {
      await hostClient.request({ type: 'session/resume', sessionId: chat.id });
    } catch {
      // Non-fatal: resume failure means the host will create a fresh handle on prompt.
    }
    try {
      const messagesResponse = await hostClient.request({
        type: 'session/messages',
        sessionId: chat.id,
      });
      if (messagesResponse.success) {
        const data = messagesResponse.data as
          | { messages: { id: string; role: string; text: string; createdAt: string }[] }
          | undefined;
        if (data?.messages) {
          const hydrated: SideChatMessage[] = data.messages
            .filter((message) => message.role === 'user' || message.role === 'assistant')
            .map((message) => ({
              id: message.id,
              role: message.role as 'user' | 'assistant',
              text: message.text,
              at: message.createdAt,
            }));
          setMessages(hydrated);
        }
      }
    } catch {
      // Non-fatal: hydration failure means the panel starts empty.
    }
  }

  async function openSideChat(): Promise<string | null> {
    if (!sessionId) return null;
    setError(null);
    try {
      const response = await hostClient.request({
        type: 'side-chat/open',
        sourceSessionId: sessionId,
      });
      if (!response.success) {
        setError(response.error);
        return null;
      }
      const data = response.data as SideChatOpenData | undefined;
      if (!data) return null;
      setActiveSideChatId(data.sideChatSessionId);
      setMessages([]);
      setResumeModel(composer.promptFields.model ?? data.session.model ?? null);
      setResumeThinkingLevel(composer.thinkingLevel);
      await commitSessionComposerProfile({
        request: (command) => hostClient.request(command),
        sessionId: data.sideChatSessionId,
        ...composer.promptFields,
      });
      await refreshList();
      return data.sideChatSessionId;
    } catch (err) {
      setError(formatError(err));
      return null;
    }
  }

  async function handleSelectSideChat(sideChatId: string): Promise<void> {
    const selected = sideChats.find((chat) => chat.id === sideChatId);
    if (!selected) return;
    await hydrateSideChat(selected);
  }

  async function handleSelectTab(tabId: string): Promise<void> {
    if (tabId === SIDE_CHAT_DRAFT_TAB_ID) {
      setActiveSideChatId(null);
      setMessages([]);
      setActiveRunId(null);
      setResumeModel(null);
      setResumeThinkingLevel(undefined);
      setError(null);
      return;
    }
    await handleSelectSideChat(tabId);
  }

  async function handleCloseTab(sideChatId: string): Promise<void> {
    if (sideChatId === SIDE_CHAT_DRAFT_TAB_ID) {
      panelChrome?.closeTab('sideChat');
      return;
    }
    setError(null);
    try {
      const response = await hostClient.request({
        type: 'session/archive',
        sessionId: sideChatId,
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const remaining = (await refreshList()).filter((chat) => chat.id !== sideChatId);
      if (remaining.length === 0) {
        panelChrome?.closeTab('sideChat');
        return;
      }
      if (activeSideChatId !== sideChatId) return;
      const next = remaining[0];
      if (next) {
        await hydrateSideChat(next);
        return;
      }
      setActiveSideChatId(null);
      setMessages([]);
      setActiveRunId(null);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleSend(textOverride?: string): Promise<void> {
    const text = (textOverride ?? input).trim();
    const promptRefs = contextRefs.snapshotContextRefs();
    if ((!text && promptRefs.length === 0) || !sessionId || streaming) return;
    const promptFields = composer.promptFields;
    let targetId = activeSideChatId;
    if (!targetId) {
      targetId = await openSideChat();
      if (!targetId) return;
    }

    const userMessage: SideChatMessage = {
      id: `${Date.now()}-u`,
      role: 'user',
      text,
      at: new Date().toISOString(),
    };
    setMessages((current) => appendBoundedSideChatMessage(current, userMessage));
    setInput('');
    setStreaming(true);
    setError(null);

    try {
      const response = await sendSideChatPrompt({
        request: (command, options) => hostClient.request(command, options),
        sessionId: targetId,
        text,
        createIdempotencyKey: createGestureIdempotencyKey,
        remoteForegroundAdmission: hostClient.supportsForegroundAdmission(),
        ...promptFields,
        ...(promptRefs.length > 0 ? { contextRefs: promptRefs } : {}),
      });
      if (!response.success) {
        const problem = readForegroundProblem(response);
        setError(problem ? foregroundMismatchNotice(problem, locale) : response.error);
        setStreaming(false);
        return;
      }
      contextRefs.clearContextRefs();
      const runId = (response.data as { runId?: string } | undefined)?.runId;
      if (typeof runId === 'string' && runId.length > 0) {
        setActiveRunId(runId);
      }
    } catch (err) {
      setError(formatError(err));
      setStreaming(false);
    }
  }

  async function handleStop(): Promise<void> {
    if (!activeSideChatId) return;
    try {
      let runId = activeRunId;
      if (runId === null) {
        const foreground = await hostClient.request({
          type: 'session/foreground-run',
          sessionId: activeSideChatId,
        });
        const run =
          foreground.success
            ? ((foreground.data as { run?: { runId?: string } | null } | undefined)?.run ?? null)
            : null;
        runId = typeof run?.runId === 'string' ? run.runId : null;
      }
      await abortSideChatRun({
        request: (command, options) => hostClient.request(command, options),
        sessionId: activeSideChatId,
        runId,
        createIdempotencyKey: createGestureIdempotencyKey,
      });
    } catch {
      // Abort is best-effort.
    }
  }

  function handleInsertLastResponse(): void {
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    if (lastAssistant && props.onInsertToMain) {
      props.onInsertToMain(lastAssistant.text);
    }
  }


  const tabs = listSideChatTabs(sideChats, locale);
  const activeTabId = activeSideChatId ?? SIDE_CHAT_DRAFT_TAB_ID;
  const showEmpty = messages.length === 0 && !assistantBuffer && !streaming;

  return (
    <div className="side-chat-panel" data-testid="side-chat-panel">
      <SideChatTabStrip
        tabs={tabs}
        activeId={activeTabId}
        locale={locale}
        onSelect={(id) => void handleSelectTab(id)}
        onClose={(id) => void handleCloseTab(id)}
      />

      {error ? (
        <div className="side-chat-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="side-chat-messages" role="log" aria-live="polite">
        {showEmpty ? (
          <SideChatEmptyState locale={locale} hasMainSession={Boolean(sessionId)} />
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={message.role === 'user' ? 'side-chat-message user' : 'side-chat-message'}
                data-testid={`side-chat-message-${message.role}`}
              >
                <div className="side-chat-bubble">
                  {message.role === 'assistant' ? (
                    <SideChatAssistantBody text={message.text} streaming={false} locale={locale} />
                  ) : (
                    message.text
                  )}
                </div>
              </div>
            ))}
            {assistantBuffer ? (
              <div className="side-chat-message assistant" data-testid="side-chat-message-streaming">
                <div className="side-chat-bubble">
                  <SideChatAssistantBody text={assistantBuffer} streaming locale={locale} />
                </div>
              </div>
            ) : null}
            {streaming && !assistantBuffer ? (
              <div className="side-chat-activity" data-testid="side-chat-activity" role="status">
                <RadialBellow
                  size="sm"
                  label="Agent is working"
                  testId="side-chat-activity-animation"
                />
                <span>{locale === 'zh-CN' ? '正在连接模型…' : 'Connecting…'}</span>
              </div>
            ) : null}
          </>
        )}
        <div ref={endRef} />
      </div>

      {activeSideChatId && messages.some((message) => message.role === 'assistant') && props.onInsertToMain ? (
        <div className="side-chat-handoff">
          <Button size="compact" variant="ghost" onClick={handleInsertLastResponse} data-testid="side-chat-insert">
            {locale === 'zh-CN' ? '插入主会话' : 'Insert to main'}
          </Button>
        </div>
      ) : null}

      <div className="side-chat-composer">
        <ComposerCard
          {...buildSideChatComposerProps({
            composer: input,
            onComposerChange: setInput,
            streaming,
            activeSideChatId,
            mainSessionReady: Boolean(sessionId),
            modelOptions: composer.modelOptions,
            selectedModelKey: composer.selectedModelKey,
            selectedModelLabel: composer.selectedModelLabel,
            thinkingLevel: composer.thinkingLevel,
            onSelectModel: (key: string) => void composer.selectModel(key),
            onThinkingLevelChange: (level) => void composer.setThinkingLevel(level),
            onSend: (text) => void handleSend(text),
            onStop: () => void handleStop(),
            pendingContextRefs: contextRefs.pendingContextRefs,
            onRemoveContextRef: contextRefs.removeContextRef,
          })}
        />
      </div>
    </div>
  );
}
