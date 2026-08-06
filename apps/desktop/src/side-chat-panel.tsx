/**
 * Side Chat panel — Host-backed persistent side chat (spec §10).
 *
 * Replaces the scratchpad. The panel:
 *  - Lists side chats for the active main session via `side-chat/list`.
 *  - Opens a new side chat via `side-chat/open`.
 *  - Sends prompts via `session/prompt` (read-only tool profile compiled at
 *    creation time; no UI-side gating needed).
 *  - Syncs context from the source session via `side-chat/sync`.
 *  - Subscribes to `event` + `run/terminal` pushes filtered by side chat sessionId.
 *  - Offers handoff: insert side chat response into the main composer.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { formatError } from '@piwin/contracts';
import type {
  AgentEvent,
  HostServerMessage,
  SessionSummary,
  SideChatOpenData,
  SideChatSyncData,
} from '@piwin/contracts';
import type { HostClient } from './host-client';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type SideChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: string;
};

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
  const endRef = useRef<HTMLDivElement | null>(null);

  const [sideChats, setSideChats] = useState<SessionSummary[]>([]);
  const [activeSideChatId, setActiveSideChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SideChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [contextVersion, setContextVersion] = useState(0);
  const [sourceState, setSourceState] = useState<string>('active');
  const [error, setError] = useState<string | null>(null);
  const [assistantBuffer, setAssistantBuffer] = useState('');

  // Refresh side chat list when the main session changes.
  const refreshList = useCallback(async () => {
    if (!sessionId) {
      setSideChats([]);
      return;
    }
    try {
      const response = await hostClient.sideChatList(sessionId);
      if (response.success) {
        const data = response.data as { sessions: SessionSummary[] } | undefined;
        setSideChats(data?.sessions ?? []);
      }
    } catch {
      // Non-fatal: list refresh is best-effort.
    }
  }, [hostClient, sessionId]);

  useEffect(() => {
    void refreshList();
    // Clear messages when main session changes.
    setActiveSideChatId(null);
    setMessages([]);
    setContextVersion(0);
    setSourceState('active');
  }, [sessionId, refreshList]);

  // Subscribe to agent events for the active side chat.
  useEffect(() => {
    if (!activeSideChatId) return;

    const unsubscribe = hostClient.subscribe((message: HostServerMessage) => {
      if (message.type === 'event' && message.sessionId === activeSideChatId) {
        handleAgentEvent(message.event);
      } else if (message.type === 'run/terminal' && message.run.sessionId === activeSideChatId) {
        setStreaming(false);
        // Flush any remaining assistant buffer.
        setAssistantBuffer((buffer) => {
          if (buffer) {
            const flushedMessage: SideChatMessage = {
              id: `${Date.now()}-a`,
              role: 'assistant',
              text: buffer,
              at: new Date().toISOString(),
            };
            setMessages((current) => [...current, flushedMessage]);
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
        setAssistantBuffer((buffer) => buffer + event.delta);
        break;
      case 'message/text_snapshot':
        setAssistantBuffer(event.text);
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
            setMessages((current) => [...current, assistantMessage]);
          }
          return '';
        });
        break;
      default:
        // Ignore tool/usage/permission events in the side chat panel for now.
        break;
    }
  }

  async function handleOpenSideChat(): Promise<void> {
    if (!sessionId) return;
    setError(null);
    try {
      const response = await hostClient.sideChatOpen(sessionId);
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as SideChatOpenData | undefined;
      if (!data) return;
      setActiveSideChatId(data.sideChatSessionId);
      setMessages([]);
      setContextVersion(data.relation.contextVersion);
      setSourceState(data.relation.sourceState);
      await refreshList();
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleSelectSideChat(sideChatId: string): Promise<void> {
    const selected = sideChats.find((chat) => chat.id === sideChatId);
    if (!selected) return;
    setActiveSideChatId(sideChatId);
    setMessages([]);
    setContextVersion(selected.sideChatRelation?.contextVersion ?? 0);
    setSourceState(selected.sideChatRelation?.sourceState ?? 'active');
    setError(null);

    // Resume the session in the host.
    try {
      await hostClient.request({ type: 'session/resume', sessionId: sideChatId });
    } catch {
      // Non-fatal: resume failure means the host will create a fresh handle on prompt.
    }

    // SIDE §11.4(4): hydrate the existing transcript so the user sees prior
    // side-chat messages after switching panels or reconnecting.
    try {
      const messagesResponse = await hostClient.request({
        type: 'session/messages',
        sessionId: sideChatId,
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

  async function handleSync(): Promise<void> {
    if (!activeSideChatId) return;
    setSyncing(true);
    setError(null);
    try {
      const response = await hostClient.sideChatSync(activeSideChatId);
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as SideChatSyncData | undefined;
      if (data) {
        setContextVersion(data.relation.contextVersion);
        setSourceState(data.relation.sourceState);
      }
      // SIDE §11: refresh the picker so the version badge updates.
      await refreshList();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSyncing(false);
    }
  }

  async function handleSend(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = input.trim();
    if (!text || !activeSideChatId || streaming) return;

    const userMessage: SideChatMessage = {
      id: `${Date.now()}-u`,
      role: 'user',
      text,
      at: new Date().toISOString(),
    };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setStreaming(true);
    setError(null);

    try {
      const response = await hostClient.request({
        type: 'session/prompt',
        sessionId: activeSideChatId,
        input: { text },
      });
      if (!response.success) {
        setError(response.error);
        setStreaming(false);
      }
    } catch (err) {
      setError(formatError(err));
      setStreaming(false);
    }
  }

  async function handleStop(): Promise<void> {
    if (!activeSideChatId) return;
    try {
      await hostClient.request({
        type: 'session/abort',
        sessionId: activeSideChatId,
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


  const canSync = activeSideChatId !== null && sourceState === 'active' && !syncing;
  const canSend = activeSideChatId !== null && !streaming && input.trim().length > 0;

  return (
    <div className="side-chat-panel" data-testid="side-chat-panel">
      {/* Header: picker + context info */}
      <div className="side-chat-header">
        {activeSideChatId ? (
          <>
            <select
              className="side-chat-picker"
              value={activeSideChatId}
              onChange={(event) => void handleSelectSideChat(event.target.value)}
              aria-label="Select side chat"
            >
              {sideChats.map((chat) => (
                <option key={chat.id} value={chat.id}>
                  {chat.name ?? '(unnamed)'} · v{chat.sideChatRelation?.contextVersion ?? 0}
                </option>
              ))}
            </select>
            <Button
              size="compact"
              variant="ghost"
              onClick={() => void handleSync()}
              disabled={!canSync}
              data-testid="side-chat-sync"
            >
              {syncing ? 'Syncing…' : 'Sync'}
            </Button>
          </>
        ) : (
          <Button
            size="compact"
            variant="secondary"
            onClick={() => void handleOpenSideChat()}
            disabled={!sessionId}
            data-testid="side-chat-new"
          >
            New Side Chat
          </Button>
        )}
      </div>

      {/* Context info bar */}
      {activeSideChatId && (
        <div className="side-chat-context-bar">
          <span className="side-chat-context-version">Context v{contextVersion}</span>
          <span className="side-chat-context-source">
            Source: {sourceState}
          </span>
          <span className="side-chat-mode">Read-only</span>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="side-chat-error" role="alert">
          {error}
        </div>
      )}

      {/* Messages */}
      <div className="side-chat-messages" role="log" aria-live="polite">
        {messages.length === 0 && !assistantBuffer ? (
          <div className="muted side-chat-empty">
            {activeSideChatId
              ? 'Ask a question about the current context. The side chat is read-only — it can search and read files but cannot modify them.'
              : 'Open a side chat to ask questions about the current session context.'}
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={message.role === 'user' ? 'side-chat-message user' : 'side-chat-message'}
                data-testid={`side-chat-message-${message.role}`}
              >
                <div className="side-chat-bubble">{message.text}</div>
              </div>
            ))}
            {assistantBuffer && (
              <div className="side-chat-message assistant" data-testid="side-chat-message-streaming">
                <div className="side-chat-bubble">{assistantBuffer}</div>
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>

      {/* Handoff: insert last assistant response into main composer */}
      {activeSideChatId && messages.some((message) => message.role === 'assistant') && props.onInsertToMain && (
        <div className="side-chat-handoff">
          <Button size="compact" variant="ghost" onClick={handleInsertLastResponse} data-testid="side-chat-insert">
            Insert to main
          </Button>
        </div>
      )}

      {/* Composer: Send / Stop only (no attachments, no mode toggle) */}
      <form className="side-chat-composer" onSubmit={handleSend}>
        <input
          className="side-chat-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={activeSideChatId ? 'Ask about the context…' : 'Open a side chat first'}
          aria-label="Side chat input"
          spellCheck={false}
          autoComplete="off"
          disabled={!activeSideChatId}
        />
        {streaming ? (
          <Button type="button" variant="danger" onClick={() => void handleStop()} data-testid="side-chat-stop">
            Stop
          </Button>
        ) : (
          <Button type="submit" data-testid="side-chat-send" disabled={!canSend}>
            Send
          </Button>
        )}
      </form>
    </div>
  );
}
