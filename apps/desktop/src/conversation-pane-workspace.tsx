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
  CONVERSATION_PANE_MAX_COUNT,
  PRIMARY_CONVERSATION_PANE_ID,
  listConversationPaneLeaves,
  type ConversationPaneLeaf,
  type ConversationPanePreset,
} from './conversation-pane-layout.js';
import { listConversationPaneRects } from './conversation-pane-navigation.js';
import type { ConversationPaneLayoutController } from './use-conversation-pane-layout.js';
import { resolveConversationPaneShortcut } from './conversation-pane-shortcuts.js';
import {
  ConversationPaneSeparator,
  listConversationPaneSplitRects,
} from './conversation-pane-separator.js';
import { ConversationPaneSession } from './conversation-pane-session.js';
import { ConversationPaneEmptyState } from './conversation-pane-empty-state.js';
import { ConversationPaneHeader } from './conversation-pane-header.js';
import type { MediaPreviewReader } from './transcript-media-preview.js';

const MIN_PANE_WIDTH = 300;
const MIN_PANE_HEIGHT = 220;

export type ConversationPaneWorkspaceProps = {
  controller: ConversationPaneLayoutController;
  primaryPane: ReactNode;
  primarySessionName: string;
  sessions: readonly SessionListItemUi[];
  hostClient: HostClient;
  activeTheme: ThemeManifest;
  artifactThemeKey: string | number;
  readMedia: MediaPreviewReader | null;
  locale: 'zh-CN' | 'en';
  keyboardEnabled?: boolean;
  onCreateConversation: () => Promise<string | null>;
};

function requiredPresetSize(count: ConversationPanePreset): { width: number; height: number } {
  if (count === 8) return { width: MIN_PANE_WIDTH * 4, height: MIN_PANE_HEIGHT * 2 };
  if (count === 4) return { width: MIN_PANE_WIDTH * 2, height: MIN_PANE_HEIGHT * 2 };
  if (count === 2) return { width: MIN_PANE_WIDTH * 2, height: MIN_PANE_HEIGHT };
  return { width: MIN_PANE_WIDTH, height: MIN_PANE_HEIGHT };
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
  const { controller } = props;
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
      rootRef.current
        ?.querySelector<HTMLElement>('[data-conversation-pane-active="true"]')
        ?.focus({ preventScroll: true });
    });
  }

  function getStageElement(): HTMLElement | null {
    const root = rootRef.current;
    if (!root) return null;
    return root.clientWidth > 0 && root.clientHeight > 0 ? root : root.parentElement;
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
    if (!canApplyPreset(count)) {
      explainInsufficientSpace();
      return;
    }
    controller.applyPreset(count);
    focusActivePaneSoon();
  }

  function splitPane(paneId: string, orientation: 'row' | 'column'): void {
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
      (orientation === 'row' && width < MIN_PANE_WIDTH * 2) ||
      (orientation === 'column' && height < MIN_PANE_HEIGHT * 2)
    ) {
      explainInsufficientSpace();
      return;
    }
    controller.split(paneId, orientation);
    focusActivePaneSoon();
  }

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
      event.preventDefault();
      const activePaneId = controller.layout.activePaneId;
      if (command.type === 'split') splitPane(activePaneId, command.orientation);
      if (command.type === 'focus-adjacent') controller.focusAdjacent(command.offset);
      if (command.type === 'focus-direction') controller.focusDirection(command.direction);
      if (command.type === 'resize') controller.resizeFocused(command.direction);
      if (command.type === 'maximize' && multiplePanes) {
        controller.toggleMaximized(activePaneId);
      }
      if (command.type === 'close') controller.close(activePaneId);
      focusActivePaneSoon();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [controller, leaves.length, multiplePanes, props.keyboardEnabled, props.locale, rectangles]);

  async function createConversation(paneId: string): Promise<void> {
    if (creatingPaneId !== null) return;
    setCreatingPaneId(paneId);
    try {
      const sessionId = await props.onCreateConversation();
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
  return (
    <div
      ref={rootRef}
      className={`conversation-pane-workspace${multiplePanes ? '' : ' is-single-pane'}${maximizedPaneId && multiplePanes ? ' has-maximized-pane' : ''}`}
      data-testid="conversation-pane-workspace"
      data-pane-count={leaves.length}
    >
      {leaves.map((leaf, index) => {
        const rect = rectangles.find((item) => item.paneId === leaf.paneId);
        if (!rect) return null;
        const active = controller.layout.activePaneId === leaf.paneId;
        const hidden = maximizedPaneId !== null && maximizedPaneId !== leaf.paneId;
        const style =
          maximizedPaneId === leaf.paneId
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
            {...(multiplePanes
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
            {multiplePanes ? (
              <ConversationPaneHeader
                paneId={leaf.paneId}
                index={index}
                title={resolvePaneTitle(leaf, index)}
                active={active}
                maximized={maximizedPaneId === leaf.paneId}
                closable={leaf.paneId !== PRIMARY_CONVERSATION_PANE_ID}
                splitDisabled={leaves.length >= CONVERSATION_PANE_MAX_COUNT}
                locale={props.locale}
                onApplyPreset={applyPreset}
                onSplit={splitPane}
                onToggleMaximized={controller.toggleMaximized}
                onClose={controller.close}
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
                  readMedia={props.readMedia}
                  locale={props.locale}
                  onNameChange={(name) =>
                    setSessionNames((current) => ({ ...current, [sessionId]: name }))
                  }
                  onSessionDeleted={() => controller.bindSession(leaf.paneId, null)}
                />
              ) : (
                <ConversationPaneEmptyState
                  paneId={leaf.paneId}
                  sessions={availableSessions}
                  creating={creatingPaneId === leaf.paneId}
                  createDisabled={creatingPaneId !== null}
                  locale={props.locale}
                  onCreate={(paneId) => void createConversation(paneId)}
                  onSelect={controller.bindSession}
                />
              )}
            </div>
          </section>
        );
      })}
      {maximizedPaneId === null
        ? splitRectangles.map((split) => (
            <ConversationPaneSeparator
              key={split.splitId}
              split={split}
              rootRef={rootRef}
              locale={props.locale}
              onRatioChange={controller.setRatio}
            />
          ))
        : null}
      {notice ? (
        <div className="conversation-pane-notice" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
