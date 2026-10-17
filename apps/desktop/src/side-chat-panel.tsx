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
 *
 * Rendering capabilities (Inline/Canvas artifacts, media previews) come from
 * the caller and follow the main session's scope: a side chat inherits that
 * scope on the Host, so the model is prompted with the same Artifact surfaces.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Button, Spinner } from '@piwin/ui-kit';
import { formatError } from '@piwin/contracts';
import type {
  SessionSummary,
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
import {
  bindSideChat,
  boundSideChatIds,
  getSideChatBinding,
  takeSideChatBinding,
} from './side-chat-sessions.js';
import type { ArtifactCanvasTarget } from './artifact-canvas-model.js';
import type { DocumentOpenInput } from './tool-call-card.js';
import type { MediaPreviewReader } from './transcript-media-preview.js';

export type SideChatPanelProps = {
  /** Active main session id (the source for side chats). */
  sessionId?: string | null;
  /** Right-panel instance this panel renders (one side chat per tab). */
  tabId: string;
  hostClient: HostClient;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  /** Inline/Canvas switches resolved for the main session's scope. */
  artifactInlineEnabled: boolean;
  artifactCanvasEnabled: boolean;
  readMedia: MediaPreviewReader | null;
  locale: 'zh-CN' | 'en';
  fileBrowseRoot?: string | null;
  onOpenDocument?: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
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

  // The bound side chat is gone on the Host (archived elsewhere, deleted):
  // drop the stale binding and resolve again instead of loading forever.
  const handleSideChatDeleted = useCallback(() => {
    if (!mainSessionId) return;
    takeSideChatBinding(mainSessionId, tabId);
    setAttempt((value) => value + 1);
  }, [mainSessionId, tabId]);

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
      <ConversationPaneSession
        key={sideChatSessionId}
        sessionId={sideChatSessionId}
        hostClient={hostClient}
        activeTheme={props.activeTheme}
        artifactThemeKey={props.artifactThemeKey}
        artifactInlineEnabled={props.artifactInlineEnabled}
        artifactCanvasEnabled={props.artifactCanvasEnabled}
        readMedia={props.readMedia}
        locale={props.locale}
        onSessionDeleted={handleSideChatDeleted}
        {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
        {...(props.onOpenArtifactCanvas
          ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
          : {})}
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
