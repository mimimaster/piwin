// @vitest-environment happy-dom
/**
 * Capability-off lock through the real ChatThread / Subagent chain.
 * `artifactPreviewEnabled={false}` is forwarded as a boolean (never a truthy
 * spread). Target: source-only, never iframe / static / canvas launcher.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { resetArtifactInitQueueForTests } from './artifact-init-queue.js';
import { resetArtifactLiveHostRegistryForTests } from './artifact-live-host-registry.js';
import { getArtifactFixture } from '@piwin/artifact/fixtures';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ChatThread } from './chat-thread';
import {
  chatUiReducer,
  createInitialChatUiState,
  type ChatMessageUi,
} from './chat-reducer';
import type { ComposerDockProps } from './composer-dock';
import { SubagentSessionTranscript } from './subagent-session-transcript';
import { TranscriptViewport } from './transcript-viewport';

vi.mock('./artifact-native-bridge.js', () => ({
  subscribeNativeArtifactBridge: vi.fn(async () => () => undefined),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function noop(): void {
  /* test stub */
}

const composerCard: ComposerDockProps = {
  layoutMode: 'docked',
  projectPath: null,
  projectTrusted: true,
  activeSessionId: null,
  streaming: false,
  runPhase: 'idle',
  compacting: false,
  composer: '',
  onComposerChange: noop,
  agentMode: 'agent',
  onAgentModeChange: noop,
  pendingAttachments: [],
  onRemoveAttachment: noop,
  dropActive: false,
  onDropActiveChange: noop,
  plusMenuOpen: false,
  onPlusMenuOpenChange: noop,
  plusSubmenu: 'none',
  onPlusSubmenuChange: noop,
  modelOptions: [],
  selectedModelKey: '',
  onSelectModel: noop,
  menuSkills: [],
  menuMcp: [],
  onRefreshComposerMenus: noop,
  onOpenSkillsPanel: noop,
  onOpenMcpPanel: noop,
  onAttachFile: noop,
  onAttachImage: noop,
  onPaste: noop,
  onDrop: noop,
  onSend: noop,
  onPause: noop,
  onAbort: noop,
  onCompact: noop,
  contextUsage: null,
  onSteer: noop,
  onFollowUp: noop,
};

const SCRIPT_MARKDOWN = getArtifactFixture('script-fragment').markdown;
const CANVAS_MARKDOWN = getArtifactFixture('explicit-canvas').markdown;

function assistantMessage(id: string, text: string): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };
}

function userMessage(id: string, text: string): ChatMessageUi {
  return {
    id,
    role: 'user',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };
}

const mounted: Array<{ container: HTMLElement; root: Root }> = [];

function renderTree(node: ReactElement): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  mounted.push({ container, root });
  return container;
}

async function flushFrame(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function expectSourceOnly(container: HTMLElement): void {
  expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
  expect(container.querySelector('iframe')).toBeNull();
  expect(container.querySelector('[data-testid="artifact-static"]')).toBeNull();
  expect(container.querySelector('[data-testid="artifact-frame"]')).toBeNull();
  expect(container.querySelector('[data-testid="artifact-canvas-launcher"]')).toBeNull();
  expect(container.querySelector('[data-testid="artifact-canvas-panel"]')).toBeNull();
}

function hydrateHistoryMessages(): ChatMessageUi[] {
  let state = createInitialChatUiState();
  state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-capability-off' });
  state = chatUiReducer(state, {
    type: 'session/load-messages',
    sessionId: 'session-capability-off',
    messages: [
      {
        id: 'tail-user',
        role: 'user',
        text: 'latest request',
        createdAt: '2026-08-12T00:10:00.000Z',
        status: 'done',
      },
      {
        id: 'tail-assistant',
        role: 'assistant',
        text: 'latest live answer',
        createdAt: '2026-08-12T00:10:01.000Z',
        status: 'done',
      },
    ],
  });
  state = chatUiReducer(state, {
    type: 'session/seek-messages',
    sessionId: 'session-capability-off',
    epoch: state.userMessageIndexEpoch,
    messages: [
      {
        id: 'u-history',
        role: 'user',
        text: 'old turn',
        createdAt: '2026-08-01T00:00:00.000Z',
        status: 'done',
      },
      {
        id: 'a-history',
        role: 'assistant',
        text: SCRIPT_MARKDOWN,
        createdAt: '2026-08-01T00:00:01.000Z',
        status: 'done',
      },
    ],
    window: {
      revision: 'history-revision',
      totalCount: 40,
      startIndex: 0,
      endIndex: 2,
      messageBytes: 256,
      anchorMessageId: 'u-history',
      anchorOffset: 0,
    },
  });
  const historyMessages = state.historyView?.messages;
  if (!historyMessages) {
    throw new Error('expected session/seek-messages to populate historyView');
  }
  return historyMessages;
}

function workbenchChatThread(messages: ChatMessageUi[], conversation: boolean): ReactElement {
  return (
    <ChatThread
      messages={messages}
      sessionId="session-capability-off"
      streaming={false}
      editingMessageId={null}
      lastUserMessageId={messages.find((message) => message.role === 'user')?.id ?? null}
      activeTheme={null}
      artifactThemeKey={0}
      onEdit={noop}
      onCancelEdit={noop}
      onEditResend={noop}
      onRetry={noop}
      onInspectSubagent={undefined}
      composerCard={composerCard}
      locale="en"
      artifactPreviewEnabled={false}
      onOpenArtifactCanvas={noop}
      {...(conversation ? { isConversationSession: true } : {})}
    />
  );
}

describe('artifact capability off (workbench / subagent / history)', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
  });

  afterEach(() => {
    while (mounted.length > 0) {
      const render = mounted.pop();
      if (!render) continue;
      act(() => {
        render.root.unmount();
      });
      render.container.remove();
    }
    resetArtifactInitQueueForTests();
    resetArtifactLiveHostRegistryForTests();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('正文 agent: artifactPreviewEnabled={false} stays source-only', async () => {
    const container = renderTree(
      workbenchChatThread(
        [userMessage('u-agent', 'show ui'), assistantMessage('a-agent', SCRIPT_MARKDOWN)],
        false,
      ),
    );
    await flushFrame();
    expectSourceOnly(container);
  });

  it('正文 conversation: artifactPreviewEnabled={false} stays source-only', async () => {
    const container = renderTree(
      workbenchChatThread(
        [userMessage('u-body', 'show ui'), assistantMessage('a-body', SCRIPT_MARKDOWN)],
        true,
      ),
    );
    await flushFrame();
    expectSourceOnly(container);
  });

  it('正文 conversation: canvas fence does not mount a launcher when capability is off', async () => {
    const container = renderTree(
      workbenchChatThread(
        [userMessage('u-canvas', 'wide ui'), assistantMessage('a-canvas', CANVAS_MARKDOWN)],
        true,
      ),
    );
    await flushFrame();
    expectSourceOnly(container);
  });

  it(
    'history: session/seek-messages hydrate in TranscriptViewport stays source-only when capability is off',
    async () => {
      const historyMessages = hydrateHistoryMessages();
      expect(historyMessages.map((message) => message.id)).toEqual(['u-history', 'a-history']);
      const container = renderTree(
        <TranscriptViewport
          sessionId="session-capability-off"
          messageCount={historyMessages.length}
          activitySignal="history-view"
          messages={historyMessages}
          locale="en"
          historyViewActive
          liveTurnId={null}
        >
          {workbenchChatThread(historyMessages, true)}
        </TranscriptViewport>,
      );
      await flushFrame();
      expect(container.textContent).not.toContain('latest live answer');
      expectSourceOnly(container);
    },
  );

  it('Subagent inspector transcript stays source-only when capability is off', async () => {
    const container = renderTree(
      <SubagentSessionTranscript
        historicalMessages={[assistantMessage('child-history', SCRIPT_MARKDOWN)]}
        stream={{
          childSessionId: 'child-session-1',
          completedSegments: [],
          completionRevision: 0,
          text: CANVAS_MARKDOWN,
          thinking: '',
          tools: [],
          streaming: false,
          currentMessageId: 'child-live',
        }}
        loading={false}
        error={null}
        onRetry={noop}
        locale="en"
        childSessionId="child-session-1"
        artifactPreviewEnabled={false}
        onOpenArtifactCanvas={noop}
      />,
    );
    await flushFrame();
    expectSourceOnly(container);
  });
});
