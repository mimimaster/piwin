import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import type { SessionListItemUi } from './chat-reducer.js';
import type { HostClient } from './host-client.js';
import {
  CONVERSATION_PANE_MIN_HEIGHT,
  CONVERSATION_PANE_MAX_COUNT,
  CONVERSATION_PANE_MIN_WIDTH,
  PRIMARY_CONVERSATION_PANE_ID,
  constrainConversationPaneLayout,
  listConversationPaneLeaves,
  setConversationPaneSplitRatio,
  type ConversationPaneLeaf,
  type ConversationPaneLayout,
  type ConversationPanePreset,
} from './conversation-pane-layout.js';
import {
  listConversationPaneRects,
  resizeFocusedConversationPane,
} from './conversation-pane-navigation.js';
import type { ConversationPaneLayoutController } from './use-conversation-pane-layout.js';
import { resolveConversationPaneShortcut } from './conversation-pane-shortcuts.js';
import {
  ConversationPaneSeparator,
  listConversationPaneSplitRects,
} from './conversation-pane-separator.js';
import { ConversationPaneSession } from './conversation-pane-session.js';
import { ConversationPaneEmptyState } from './conversation-pane-empty-state.js';
import { ConversationPaneHeader } from './conversation-pane-header.js';
import { ConversationPaneLayoutPresets } from './conversation-pane-layout-presets.js';
import type { MediaPreviewReader } from './transcript-media-preview.js';
import type { ArtifactCanvasTarget } from './artifact-canvas-model.js';
import type { DocumentOpenInput } from './tool-call-card.js';

export type ConversationPaneWorkspaceProps = {
  controller: ConversationPaneLayoutController;
  primaryPane: ReactNode;
  primarySessionName: string;
  sessions: readonly SessionListItemUi[];
  hostClient: HostClient;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  artifactPreviewEnabled: boolean;
  readMedia: MediaPreviewReader | null;
  locale: 'zh-CN' | 'en';
  keyboardEnabled?: boolean;
  /** Phone presentation: keep the split tree, show only the active pane. */
  phoneSinglePane?: boolean;
  onCreateConversation: (paneId: string) => Promise<string | null>;
  onOpenDocument?: (doc: DocumentOpenInput, target?: 'stage' | 'inspector') => void;
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  fileBrowseRoot?: string | null;
};

function requiredPresetSize(count: ConversationPanePreset): { width: number; height: number } {
  if (count === 8)
    return { width: CONVERSATION_PANE_MIN_WIDTH * 4, height: CONVERSATION_PANE_MIN_HEIGHT * 2 };
  if (count === 4)
    return { width: CONVERSATION_PANE_MIN_WIDTH * 2, height: CONVERSATION_PANE_MIN_HEIGHT * 2 };
  if (count === 2)
    return { width: CONVERSATION_PANE_MIN_WIDTH * 2, height: CONVERSATION_PANE_MIN_HEIGHT };
  return { width: CONVERSATION_PANE_MIN_WIDTH, height: CONVERSATION_PANE_MIN_HEIGHT };
}

export function conversationPanePresetFits(
  currentCount: number,
  targetCount: ConversationPanePreset,
  width: number,
  height: number,
): boolean {
  if (targetCount <= currentCount) return true;
  const required = requiredPresetSize(targetCount);
  return width >= required.width && height >= required.height;
}

function leafStyle(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): CSSProperties {
  return {
    left: `${rect.left * 100}%`,
    top: `${rect.top * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

export function ConversationPaneWorkspace(props: ConversationPaneWorkspaceProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creatingPaneId, setCreatingPaneId] = useState<string | null>(null);
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});
  const { controller, phoneSinglePane = false } = props;
  const leaves = useMemo(
    () => listConversationPaneLeaves(controller.layout.root),
    [controller.layout.root],
  );
  const rectangles = useMemo(
    () => listConversationPaneRects(controller.layout.root),
    [controller.layout.root],
  );
  const splitRectangles = useMemo(
    () => listConversationPaneSplitRects(controller.layout.root),
    [controller.layout.root],
  );
  const boundSessionIds = useMemo(
    () => new Set(leaves.flatMap((leaf) => (leaf.sessionId ? [leaf.sessionId] : []))),
    [leaves],
  );
  const multiplePanes = leaves.length > 1;

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function focusActivePaneSoon(): void {
    window.requestAnimationFrame(() => {
      const activePane = rootRef.current?.querySelector<HTMLElement>(
        '[data-conversation-pane-active="true"]',
      );
      if (!activePane) return;
      const textarea = activePane.querySelector<HTMLTextAreaElement>(
        'textarea, [contenteditable="true"]',
      );
      if (textarea && !textarea.disabled) {
        textarea.focus({ preventScroll: true });
      } else {
        activePane.focus({ preventScroll: true });
      }
    });
  }

  function getStageElement(): HTMLElement | null {
    let node: HTMLElement | null = rootRef.current;
    while (node) {
      if (node.clientWidth > 0 && node.clientHeight > 0) return node;
      node = node.parentElement;
    }
    return null;
  }

  function explainInsufficientSpace(): void {
    setNotice(
      props.locale === 'zh-CN'
        ? '当前窗口太小，无法保持每个 Chat 的可读尺寸。可先放大窗口或最大化一个窗格。'
        : 'The window is too small to keep every Chat readable. Enlarge it or maximize one pane.',
    );
  }

  function canApplyPreset(count: ConversationPanePreset): boolean {
    const root = getStageElement();
    if (!root) return false;
    return conversationPanePresetFits(leaves.length, count, root.clientWidth, root.clientHeight);
  }

  function applyPreset(count: ConversationPanePreset): void {
    if (phoneSinglePane) {
      explainInsufficientSpace();
      return;
    }
    if (!canApplyPreset(count)) {
      explainInsufficientSpace();
      return;
    }
    controller.applyPreset(count);
    focusActivePaneSoon();
  }

  function splitPane(paneId: string, orientation: 'row' | 'column'): void {
    if (phoneSinglePane) {
      explainInsufficientSpace();
      return;
    }
    if (leaves.length >= CONVERSATION_PANE_MAX_COUNT) {
      setNotice(
        props.locale === 'zh-CN'
          ? '一个窗口最多显示 8 个 Chat。'
          : 'A window can show at most 8 Chats.',
      );
      return;
    }
    const paneRect = rectangles.find((rect) => rect.paneId === paneId);
    const root = getStageElement();
    if (!paneRect || !root) return;
    const width = root.clientWidth * paneRect.width;
    const height = root.clientHeight * paneRect.height;
    if (
      (orientation === 'row' && width < CONVERSATION_PANE_MIN_WIDTH * 2) ||
      (orientation === 'column' && height < CONVERSATION_PANE_MIN_HEIGHT * 2)
    ) {
      explainInsufficientSpace();
      return;
    }
    controller.split(paneId, orientation);
    focusActivePaneSoon();
  }

  function updateLayoutForStage(
    transform: (layout: ConversationPaneLayout) => ConversationPaneLayout,
  ): void {
    const root = getStageElement();
    controller.update((current) => {
      const next = transform(current);
      return root
        ? constrainConversationPaneLayout(next, {
            width: root.clientWidth,
            height: root.clientHeight,
          })
        : next;
    });
  }

  function setPaneRatio(splitId: string, ratio: number): void {
    updateLayoutForStage((current) => setConversationPaneSplitRatio(current, splitId, ratio));
  }

  useEffect(() => {
    const workspace = rootRef.current;
    if (workspace === null) return;
    const observedWorkspace: HTMLDivElement = workspace;

    function reconcileLayoutSize(): void {
      const stage = getStageElement();
      if (!stage || stage.clientWidth <= 0 || stage.clientHeight <= 0) return;
      controller.update((current) =>
        constrainConversationPaneLayout(current, {
          width: stage.clientWidth,
          height: stage.clientHeight,
        }),
      );
    }

    reconcileLayoutSize();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(reconcileLayoutSize);
      observer.observe(observedWorkspace);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', reconcileLayoutSize);
    return () => window.removeEventListener('resize', reconcileLayoutSize);
  }, [controller.update, multiplePanes]);

  useEffect(() => {
    if (!phoneSinglePane) return;
    if (controller.layout.maximizedPaneId !== null) {
      controller.toggleMaximized(controller.layout.maximizedPaneId);
    }
  }, [controller, phoneSinglePane]);

  useEffect(() => {
    if (props.keyboardEnabled === false) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && controller.layout.maximizedPaneId !== null) {
        event.preventDefault();
        controller.toggleMaximized(controller.layout.maximizedPaneId);
        focusActivePaneSoon();
        return;
      }
      const command = resolveConversationPaneShortcut(event);
      if (!command) return;
      if (
        phoneSinglePane &&
        (command.type === 'split' || command.type === 'maximize' || command.type === 'resize')
      ) {
        event.preventDefault();
        explainInsufficientSpace();
        return;
      }
      event.preventDefault();
      const activePaneId = controller.layout.activePaneId;
      if (command.type === 'split') splitPane(activePaneId, command.orientation);
      if (command.type === 'focus-adjacent') controller.focusAdjacent(command.offset);
      if (command.type === 'focus-direction') controller.focusDirection(command.direction);
      if (command.type === 'resize') {
        updateLayoutForStage((current) =>
          resizeFocusedConversationPane(current, command.direction),
        );
      }
      if (command.type === 'maximize' && multiplePanes) {
        controller.toggleMaximized(activePaneId);
      }
      if (command.type === 'close') controller.close(activePaneId);
      focusActivePaneSoon();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controller, leaves.length, multiplePanes, phoneSinglePane, props.keyboardEnabled, props.locale, rectangles]);

  async function createConversation(paneId: string): Promise<void> {
    if (creatingPaneId !== null) return;
    setCreatingPaneId(paneId);
    try {
      const sessionId = await props.onCreateConversation(paneId);
      if (sessionId) controller.bindSession(paneId, sessionId);
    } finally {
      setCreatingPaneId(null);
    }
  }

  function resolvePaneTitle(leaf: ConversationPaneLeaf, index: number): string {
    if (leaf.paneId === PRIMARY_CONVERSATION_PANE_ID) return props.primarySessionName;
    if (leaf.sessionId) {
      return (
        sessionNames[leaf.sessionId] ??
        props.sessions.find((session) => session.id === leaf.sessionId)?.name ??
        (props.locale === 'zh-CN' ? `Chat ${index + 1}` : `Chat ${index + 1}`)
      );
    }
    return props.locale === 'zh-CN' ? '空 Chat' : 'Empty Chat';
  }

  const maximizedPaneId = controller.layout.maximizedPaneId;
  const phoneActivePaneId = phoneSinglePane
    ? (controller.layout.activePaneId || PRIMARY_CONVERSATION_PANE_ID)
    : null;
  const visibleMultiplePanes = multiplePanes && !phoneSinglePane;
  return (
    <div
      className={`conversation-pane-workspace${visibleMultiplePanes ? '' : ' is-single-pane'}${maximizedPaneId && visibleMultiplePanes ? ' has-maximized-pane' : ''}${phoneSinglePane ? ' is-phone-single-pane' : ''}`}
      data-testid="conversation-pane-workspace"
      data-pane-count={visibleMultiplePanes ? leaves.length : 1}
      data-phone-single-pane={phoneSinglePane ? 'true' : 'false'}
    >
      <div ref={rootRef} className="conversation-pane-stage">
      {leaves.map((leaf, index) => {
        const rect = rectangles.find((item) => item.paneId === leaf.paneId);
        if (!rect) return null;
        const active = controller.layout.activePaneId === leaf.paneId;
        const hidden = phoneSinglePane
          ? leaf.paneId !== phoneActivePaneId
          : maximizedPaneId !== null && maximizedPaneId !== leaf.paneId;
        const style =
          phoneSinglePane || maximizedPaneId === leaf.paneId
            ? leafStyle({ left: 0, top: 0, width: 1, height: 1 })
            : leafStyle(rect);
        const availableSessions = props.sessions.filter(
          (session) => !boundSessionIds.has(session.id) || session.id === leaf.sessionId,
        );
        const sessionId = leaf.sessionId;
        return (
          <section
            key={leaf.paneId}
            className={`conversation-pane${active ? ' is-active' : ''}`}
            style={style}
            hidden={hidden}
            {...(visibleMultiplePanes
              ? {
                  tabIndex: -1,
                  role: 'region',
                  'aria-label': `${resolvePaneTitle(leaf, index)} · ${index + 1}/${leaves.length}`,
                }
              : {})}
            data-pane-id={leaf.paneId}
            data-conversation-pane-active={active ? 'true' : 'false'}
            onFocus={() => controller.focus(leaf.paneId)}
            onPointerDownCapture={() => controller.focus(leaf.paneId)}
          >
            <div className="conversation-pane-frame">
            {visibleMultiplePanes ? (
              <ConversationPaneHeader
                paneId={leaf.paneId}
                index={index}
                title={resolvePaneTitle(leaf, index)}
                active={active}
                maximized={maximizedPaneId === leaf.paneId}
                closable={leaf.paneId !== PRIMARY_CONVERSATION_PANE_ID}
                splitDisabled={leaves.length >= CONVERSATION_PANE_MAX_COUNT}
                locale={props.locale}
                sessionId={sessionId}
                sessions={availableSessions}
                onApplyPreset={applyPreset}
                onSplit={splitPane}
                onToggleMaximized={controller.toggleMaximized}
                onClose={controller.close}
                onSelectSession={controller.bindSession}
                onCreateSession={(paneId) => void createConversation(paneId)}
              />
            ) : null}
            <div className="conversation-pane-body">
              {leaf.paneId === PRIMARY_CONVERSATION_PANE_ID ? (
                props.primaryPane
              ) : sessionId ? (
                <ConversationPaneSession
                  key={sessionId}
                  sessionId={sessionId}
                  hostClient={props.hostClient}
                  activeTheme={props.activeTheme}
                  artifactThemeKey={props.artifactThemeKey}
                  artifactPreviewEnabled={props.artifactPreviewEnabled}
                  readMedia={props.readMedia}
                  locale={props.locale}
                  onNameChange={(name) =>
                    setSessionNames((current) => ({ ...current, [sessionId]: name }))
                  }
                  onSessionDeleted={() => controller.bindSession(leaf.paneId, null)}
                  {...(props.onOpenDocument ? { onOpenDocument: props.onOpenDocument } : {})}
                  {...(props.onOpenArtifactCanvas
                    ? { onOpenArtifactCanvas: props.onOpenArtifactCanvas }
                    : {})}
                  {...(props.fileBrowseRoot !== undefined
                    ? { fileBrowseRoot: props.fileBrowseRoot }
                    : {})}
                />
              ) : (
                <ConversationPaneEmptyState
                  paneId={leaf.paneId}
                  creating={creatingPaneId === leaf.paneId}
                  createDisabled={creatingPaneId !== null}
                  locale={props.locale}
                  onCreate={(paneId) => void createConversation(paneId)}
                />
              )}
            </div>
            </div>
          </section>
        );
      })}
      {maximizedPaneId === null && !phoneSinglePane
        ? splitRectangles.map((split) => (
            <ConversationPaneSeparator
              key={split.splitId}
              split={split}
              rootRef={rootRef}
              locale={props.locale}
              onRatioChange={setPaneRatio}
            />
          ))
        : null}
      {notice ? (
        <div className="conversation-pane-notice" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}
      </div>
      {visibleMultiplePanes ? (
        <ConversationPaneLayoutPresets
          currentCount={leaves.length}
          locale={props.locale}
          onApplyPreset={applyPreset}
        />
      ) : null}
    </div>
  );
}
