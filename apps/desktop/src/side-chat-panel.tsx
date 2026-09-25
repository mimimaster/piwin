/**
 * Side Chat panel — a side-chat session shown in the right panel.
 *
 * A side chat is an ordinary Host session (created by `side-chat/open`, which
 * inherits the main session's context) rendered with the same
 * ConversationPaneSession used by split panes, so streaming, tool cards and
 * the composer behave exactly like a conversation window. This component only
 * decides *which* side-chat session the tab shows:
 *  - the tab's existing binding, else the newest unbound side chat of the
 *    main session, else a newly opened one;
 *  - selection seeds ("划词 → 侧聊") attach quoted context to the composer.
 * Closing the tab ends the session (see endSideChatSession).
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Button, Spinner } from '@piwin/ui-kit';
import { formatError } from '@piwin/contracts';
import type {
  SessionSummary,
  SessionTranscriptMessage,
  SideChatOpenData,
  ThemeManifest,
} from '@piwin/contracts';
import type { HostClient } from './host-client';
import { ConversationPaneSession } from './conversation-pane-session.js';
import { useComposerContextRefs } from './hooks/use-composer-context-refs.js';
import {
  subscribeSideChatComposerSeed,
  takeSideChatComposerSeed,
  type SideChatComposerSeed,
} from './side-chat-composer-seed.js';
import { bindSideChat, boundSideChatIds, getSideChatBinding } from './side-chat-sessions.js';
import type { DocumentOpenInput } from './tool-call-card.js';

export type SideChatPanelProps = {
  /** Active main session id (the source for side chats). */
  sessionId?: string | null;
  /** Right-panel instance this panel renders (one side chat per tab). */
  tabId: string;
  hostClient: HostClient;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  locale: 'zh-CN' | 'en';
  fileBrowseRoot?: string | null;
  onOpenDocument?: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  /** Insert text into the main composer (handoff). */
  onInsertToMain?: (text: string) => void;
};

type Resolution =
  | { kind: 'idle' }
  | { kind: 'resolving' }
  | { kind: 'ready'; sideChatSessionId: string }
  | { kind: 'failed'; message: string };

async function resolveSideChat(hostClient: HostClient, mainSessionId: string): Promise<string> {
  const listed = await hostClient.request({ type: 'side-chat/list', sourceSessionId: mainSessionId });
  if (listed.success) {
    const sessions = (listed.data as { sessions?: SessionSummary[] } | undefined)?.sessions ?? [];
    const taken = boundSideChatIds();
    const reusable = sessions.find((session) => !taken.has(session.id));
    if (reusable) return reusable.id;
  }
  const opened = await hostClient.request({ type: 'side-chat/open', sourceSessionId: mainSessionId });
  if (!opened.success) throw new Error(opened.error);
  const data = opened.data as SideChatOpenData | undefined;
  if (!data) throw new Error('side-chat/open returned no session');
  return data.sideChatSessionId;
}

function lastAssistantText(messages: readonly SessionTranscriptMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && typeof message.text === 'string' && message.text.trim()) {
      return message.text;
    }
  }
  return undefined;
}

export function SideChatPanel(props: SideChatPanelProps): ReactElement {
  const { hostClient, sessionId: mainSessionId, tabId } = props;
  const zh = props.locale === 'zh-CN';
  const contextRefs = useComposerContextRefs();
  const [resolution, setResolution] = useState<Resolution>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!mainSessionId) {
      setResolution({ kind: 'idle' });
      return;
    }
    const bound = getSideChatBinding(mainSessionId, tabId);
    if (bound) {
      setResolution({ kind: 'ready', sideChatSessionId: bound });
      return;
    }
    let cancelled = false;
    setResolution({ kind: 'resolving' });
    void resolveSideChat(hostClient, mainSessionId).then(
      (sideChatSessionId) => {
        if (cancelled) return;
        bindSideChat(mainSessionId, tabId, sideChatSessionId);
        setResolution({ kind: 'ready', sideChatSessionId });
      },
      (error: unknown) => {
        if (!cancelled) setResolution({ kind: 'failed', message: formatError(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [hostClient, mainSessionId, tabId, attempt]);

  const applySeed = useCallback(
    (seed: SideChatComposerSeed) => {
      contextRefs.replaceContextRefs(seed.refs);
      if (seed.sideChatSessionId && mainSessionId) {
        bindSideChat(mainSessionId, tabId, seed.sideChatSessionId);
        setResolution({ kind: 'ready', sideChatSessionId: seed.sideChatSessionId });
      }
    },
    [contextRefs.replaceContextRefs, mainSessionId, tabId],
  );

  useEffect(() => {
    const queued = takeSideChatComposerSeed();
    if (queued) applySeed(queued);
    return subscribeSideChatComposerSeed(applySeed);
  }, [applySeed]);

  async function handleInsertLastResponse(sideChatSessionId: string): Promise<void> {
    const response = await hostClient.request({ type: 'session/messages', sessionId: sideChatSessionId });
    if (!response.success) return;
    const messages =
      (response.data as { messages?: SessionTranscriptMessage[] } | undefined)?.messages ?? [];
    const text = lastAssistantText(messages);
    if (text) props.onInsertToMain?.(text);
  }

  if (!mainSessionId) {
    return (
      <div className="side-chat-panel side-chat-panel--status" data-testid="side-chat-panel">
        <p className="muted">
          {zh
            ? '先打开一个会话，侧聊会基于它的上下文。'
            : 'Open a conversation first; side chat builds on its context.'}
        </p>
      </div>
    );
  }

  if (resolution.kind === 'failed') {
    return (
      <div className="side-chat-panel side-chat-panel--status" data-testid="side-chat-panel">
        <p className="side-chat-error" role="alert">
          {zh ? '无法打开侧聊：' : 'Could not open side chat: '}
          {resolution.message}
        </p>
        <Button size="compact" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          {zh ? '重试' : 'Retry'}
        </Button>
      </div>
    );
  }

  if (resolution.kind !== 'ready') {
    return (
      <div className="side-chat-panel side-chat-panel--status" data-testid="side-chat-panel">
        <Spinner />
        <span className="muted">{zh ? '正在准备侧聊…' : 'Preparing side chat…'}</span>
      </div>
    );
  }

  const sideChatSessionId = resolution.sideChatSessionId;
  return (
    <div
      className="side-chat-panel"
      data-testid="side-chat-panel"
      data-session-id={sideChatSessionId}
    >
      {props.onInsertToMain ? (
        <div className="side-chat-toolbar">
          <Button
            size="compact"
            variant="ghost"
            onClick={() => void handleInsertLastResponse(sideChatSessionId)}
            data-testid="side-chat-insert-main"
          >
            {zh ? '插入最新回答到主会话' : 'Insert latest answer into main chat'}
          </Button>
        </div>
      ) : null}
      <ConversationPaneSession
        key={sideChatSessionId}
        sessionId={sideChatSessionId}
        hostClient={hostClient}
        activeTheme={props.activeTheme}
        artifactThemeKey={props.artifactThemeKey}
        artifactInlineEnabled={false}
        readMedia={null}
        locale={props.locale}
        {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
        {...(props.fileBrowseRoot !== undefined ? { fileBrowseRoot: props.fileBrowseRoot } : {})}
        contextRefs={{
          pending: contextRefs.pendingContextRefs,
          snapshot: contextRefs.snapshotContextRefs,
          remove: contextRefs.removeContextRef,
          clear: contextRefs.clearContextRefs,
        }}
      />
    </div>
  );
}
