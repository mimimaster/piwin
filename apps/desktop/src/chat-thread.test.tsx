// @vitest-environment happy-dom
// E1: Deterministic renderer-isolation evidence
//
// Waiver (required by plan):
// - All render probes and synthetic animation-frame scheduling are test-local
//   only -- no production code is modified.
// - The frame scheduler injection matches the exact seam used by
//   StreamEventBuffer in production (frameScheduler / frameCanceller options).

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { memo, Profiler, act, useEffect, useReducer, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AgentEvent, ExecutionRunRecord, TranscriptBranchPoint } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ChatThread, shouldCollapseTurnToolHistory, type ChatThreadProps } from './chat-thread';
import { RightPanel } from './right-panel';
import {
  chatUiReducer,
  createInitialChatUiState,
  mapTranscriptMessagesToUi,
  type ChatUiAction,
  type ChatUiState,
  type ChatMessageUi,
  type PermissionPromptUi,
  type ToolCardUi,
} from './chat-reducer';
import type { ComposerDockProps } from './composer-dock.js';
import { createStreamEventBuffer, type StreamEventBuffer } from './stream-event-buffer';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Isolated ChatThread tests default capability on. Production must pass the boolean. */
function ChatThreadHarness({
  artifactPreviewEnabled = true,
  ...props
}: Omit<ChatThreadProps, 'artifactPreviewEnabled'> & {
  artifactPreviewEnabled?: boolean;
}): ReactElement {
  return <ChatThread {...props} artifactPreviewEnabled={artifactPreviewEnabled} />;
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

function createUserMessage(id: string, text: string): ChatMessageUi {
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

it('keeps an active multi-tool call chain expanded and compacts it after completion', () => {
  const workDetailsMessage: ChatMessageUi = {
    id: 'active-chain',
    role: 'assistant',
    text: 'Working through the files',
    thinking: '',
    tools: Array.from({ length: 5 }, (_, index) => ({
      toolCallId: `tool-${index}`,
      toolName: 'bash',
      status: 'done' as const,
      output: '',
    })),
    attachments: [],
    status: 'streaming',
    runId: 'run-active-chain',
  };

  expect(
    shouldCollapseTurnToolHistory({
      workDetailsMessage,
      activeRunId: 'run-active-chain',
      answerText: workDetailsMessage.text,
    }),
  ).toBe(false);
  expect(
    shouldCollapseTurnToolHistory({
      workDetailsMessage: { ...workDetailsMessage, status: 'done' },
      activeRunId: null,
      answerText: workDetailsMessage.text,
    }),
  ).toBe(true);
});

function createStreamingAssistant(id: string): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'streaming',
  };
}

// ---------------------------------------------------------------------------
// Test-local helpers
// ---------------------------------------------------------------------------

function createHistoricalMessages(count: number): ChatMessageUi[] {
  const messages: ChatMessageUi[] = [];
  for (let i = 1; i <= count; i++) {
    const role: 'user' | 'assistant' = i % 2 === 0 ? 'user' : 'assistant';
    messages.push({
      id: `historical-${i}`,
      role,
      text: `Historical message ${i} with substantive content for render isolation verification`,
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    });
  }
  return messages;
}

function createStreamingMessage(id: string, text: string): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'streaming',
  };
}

function createDeltaEvent(messageId: string, delta: string): AgentEvent {
  return { type: 'message/text_delta', messageId, delta };
}

function requireStreamEventBuffer(value: unknown): StreamEventBuffer {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('push' in value) ||
    typeof value.push !== 'function'
  ) {
    throw new Error('The E1 harness did not expose its stream event buffer.');
  }
  return value as StreamEventBuffer;
}

// ---------------------------------------------------------------------------
// Profiler tracking
// ---------------------------------------------------------------------------

type ProfilerRecord = {
  commitIndex: number;
  phase: 'mount' | 'update' | 'nested-update';
  actualDuration: number;
};

type RenderProbe = {
  renderCount: number;
  profilerRecords: ProfilerRecord[];
};

function createRenderProbe(): RenderProbe {
  return { renderCount: 0, profilerRecords: [] };
}

function createProfilerCallback(renderProbe: RenderProbe) {
  return (
    _id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
  ): void => {
    renderProbe.profilerRecords.push({
      commitIndex: renderProbe.profilerRecords.length + 1,
      phase,
      actualDuration,
    });
  };
}

const MessageRenderProbe = memo(function MessageRenderProbe(props: {
  message: ChatMessageUi;
  renderProbe: RenderProbe;
}): null {
  props.renderProbe.renderCount++;
  return null;
});

type ChatThreadRenderHarnessProps = {
  initialState: ChatUiState;
  scheduledFrames: Array<() => void>;
  historicalMessageIndexes: number[];
  historicalRenderProbes: RenderProbe[];
  streamingRenderProbe: RenderProbe;
  onStreamEventBufferReady: (streamEventBuffer: StreamEventBuffer) => void;
};

/**
 * This mounts the same reducer-to-ChatThread update path as the desktop app.
 * The local probes receive the precise message objects passed to ChatThread;
 * their memo boundaries therefore expose whether historical identities change.
 */
function ChatThreadRenderHarness(props: ChatThreadRenderHarnessProps): ReactElement {
  const [chatState, dispatch] = useReducer(chatUiReducer, props.initialState);
  const streamEventBufferReference = useRef<StreamEventBuffer | null>(null);

  if (streamEventBufferReference.current === null) {
    streamEventBufferReference.current = createStreamEventBuffer({
      dispatch,
      frameScheduler: (callback: () => void) => {
        props.scheduledFrames.push(callback);
        return props.scheduledFrames.length;
      },
      frameCanceller: noop,
    });
  }

  const streamEventBuffer = streamEventBufferReference.current;
  useEffect(() => {
    props.onStreamEventBufferReady(streamEventBuffer);
    return () => {
      streamEventBuffer.dispose();
    };
  }, [streamEventBuffer, props.onStreamEventBufferReady]);

  const streamingMessage = chatState.messages[chatState.messages.length - 1];
  if (!streamingMessage) {
    throw new Error('The E1 harness requires a streaming message.');
  }

  return (
    <>
      <ChatThreadHarness
        messages={chatState.messages}
        streaming={chatState.streaming}
        editingMessageId={null}
        lastUserMessageId={null}
        activeTheme={null}
        artifactThemeKey={0}
        onEdit={noop}
        onCancelEdit={noop}
        onEditResend={noop}
        onRetry={noop}
        onInspectSubagent={undefined}
        composerCard={{
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
        }}
      />
      {props.historicalMessageIndexes.map((messageIndex, probeIndex) => {
        const historicalMessage = chatState.messages[messageIndex];
        const historicalRenderProbe = props.historicalRenderProbes[probeIndex];
        if (!historicalMessage || !historicalRenderProbe) {
          throw new Error('The E1 harness requires every historical probe message.');
        }
        return (
          <Profiler
            key={historicalMessage.id}
            id={`historical-row-${historicalMessage.id}`}
            onRender={createProfilerCallback(historicalRenderProbe)}
          >
            <MessageRenderProbe message={historicalMessage} renderProbe={historicalRenderProbe} />
          </Profiler>
        );
      })}
      <Profiler id="streaming-row" onRender={createProfilerCallback(props.streamingRenderProbe)}>
        <MessageRenderProbe message={streamingMessage} renderProbe={props.streamingRenderProbe} />
      </Profiler>
      <RightPanel
        open={false}
        onOpen={noop}
        onClose={noop}
        activeTab="files"
        onTabChange={noop}
        panelWidthPx={320}
        isResizing={false}
        onResizePointerDown={noop}
        onResizeReset={noop}
        filesContent={null}
        terminalContent={null}
        reviewContent={null}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

const HISTORICAL_COUNT = 500;

describe('ChatThread render isolation (E1)', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;
  let previousMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    previousMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((_query: string) => ({
      matches: false,
      media: _query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })) as unknown as typeof window.matchMedia;
    container = document.createElement('div');
    container.id = 'e1-test-container';
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    if (previousMatchMedia) {
      window.matchMedia = previousMatchMedia;
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  // ————————————————————————————————————————————————————————————————
  // 1. Historical rows + closed right panel do not rerender for a native
  //    Host burst. React batches the synchronous reducer dispatches from one
  //    wire frame; Desktop does not add a visibility-dependent frame queue.
  // ————————————————————————————————————————————————————————————————
  it('isolates historical rows and closed panel from streaming commits', () => {
    const historicalMessages = createHistoricalMessages(HISTORICAL_COUNT);
    const streamingInitialText = 'Initial streaming';
    const streamingMessage = createStreamingMessage('streaming-e1', streamingInitialText);
    const allMessages = [...historicalMessages, streamingMessage];

    const scheduledFrames: Array<() => void> = [];
    const historicalMessageIndexes = [0, 249, HISTORICAL_COUNT - 1];
    const historicalRenderProbes = historicalMessageIndexes.map(() => createRenderProbe());
    const streamingRenderProbe = createRenderProbe();
    let streamEventBuffer: StreamEventBuffer | null = null;
    const initialState: ChatUiState = {
      ...createInitialChatUiState(),
      activeSessionId: 's1',
      messages: allMessages,
      streaming: true,
      runPhase: 'streaming',
      activeRunId: 'run-e1',
    };

    // Mount once. Updates below come only from dispatch in StreamEventBuffer.
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadRenderHarness
            initialState={initialState}
            scheduledFrames={scheduledFrames}
            historicalMessageIndexes={historicalMessageIndexes}
            historicalRenderProbes={historicalRenderProbes}
            streamingRenderProbe={streamingRenderProbe}
            onStreamEventBufferReady={(buffer) => {
              streamEventBuffer = buffer;
            }}
          />
        </PiwinUiProvider>,
      );
    });

    const readyStreamEventBuffer = requireStreamEventBuffer(streamEventBuffer);
    expect(historicalRenderProbes.map((probe) => probe.renderCount)).toEqual([1, 1, 1]);
    expect(streamingRenderProbe.renderCount).toBe(1);
    // Closed panel stay keep-mounted (collapsed) so streaming commits must not
    // rely on unmounting the inspector subtree.
    expect(container.querySelector('[data-testid="right-panel"]')?.getAttribute('data-open')).toBe(
      'false',
    );

    act(() => {
      readyStreamEventBuffer.push('s1', createDeltaEvent('streaming-e1', ' plus'));
      readyStreamEventBuffer.push('s1', createDeltaEvent('streaming-e1', ' three'));
      readyStreamEventBuffer.push('s1', createDeltaEvent('streaming-e1', ' deltas'));
    });

    expect(scheduledFrames).toHaveLength(0);

    const updatedBubbles = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="message-bubble"]'),
    );
    const lastBubble = updatedBubbles[updatedBubbles.length - 1];
    expect(lastBubble?.textContent).toContain('Initial streaming plus three deltas');

    // Profiler confirms that React committed the Host-burst update. Its
    // scopes commit with the parent harness, while the memo probes below prove
    // which representative rows actually rendered during that commit.
    expect(historicalRenderProbes.map((probe) => probe.profilerRecords.length)).toEqual([2, 2, 2]);
    expect(streamingRenderProbe.profilerRecords).toHaveLength(2);

    // The test-local memo probes use the exact row inputs passed to ChatThread.
    // Historical message identities are preserved by the reducer, while the
    // changed streaming message produces exactly one observed row update.
    expect(historicalRenderProbes.map((probe) => probe.renderCount)).toEqual([1, 1, 1]);
    expect(streamingRenderProbe.renderCount).toBe(2);
    expect(container.querySelector('[data-testid="right-panel"]')?.getAttribute('data-open')).toBe(
      'false',
    );
  });

  // ————————————————————————————————————————————————————————————————
  // 2. Terminal/lifecycle events remain behind preceding deltas without a
  //    second client-side queue.
  // ————————————————————————————————————————————————————————————————
  it('keeps terminal/lifecycle events ordered after native deltas', () => {
    const historicalMessages = createHistoricalMessages(200);
    const streamingMessage = createStreamingMessage('streaming-e2', 'Partial');
    const allMessages = [...historicalMessages, streamingMessage];

    let appState: ChatUiState = {
      ...createInitialChatUiState(),
      activeSessionId: 's1',
      messages: allMessages,
      streaming: true,
      runPhase: 'streaming',
      activeRunId: 'run-e2',
    };

    const scheduledFrames: Array<() => void> = [];
    const dispatchedActions: ChatUiAction[] = [];

    const buffer = createStreamEventBuffer({
      dispatch: (action: ChatUiAction) => {
        dispatchedActions.push(action);
        appState = chatUiReducer(appState, action);
      },
      frameScheduler: (callback: () => void) => {
        scheduledFrames.push(callback);
        return scheduledFrames.length;
      },
      frameCanceller: () => {
        /* noop */
      },
    });

    // Push a text delta first; it must be reduced immediately.
    buffer.push('s1', createDeltaEvent('streaming-e2', ' delta-data'));

    // Push a terminal event after the delta, matching Host sequence order.
    const terminalRun: ExecutionRunRecord = {
      runId: 'run-e2',
      kind: 'session-turn',
      status: 'completed',
      rootRunId: 'run-e2',
      sessionId: 's1',
      endedAt: new Date().toISOString(),
      terminalCode: 'completed',
    };
    buffer.pushAction('s1', { type: 'run/terminal', run: terminalRun });

    // ---- Assertions ----

    // A. Two actions dispatched in Host order: delta, then terminal.
    expect(dispatchedActions.length).toBe(2);

    const firstAction = dispatchedActions[0];
    expect(firstAction?.type).toBe('event');
    if (firstAction?.type === 'event') {
      expect(firstAction.event.type).toBe('message/text_delta');
    }

    const secondAction = dispatchedActions[1];
    expect(secondAction?.type).toBe('run/terminal');
    if (secondAction?.type === 'run/terminal') {
      expect(secondAction.run.runId).toBe('run-e2');
    }

    // B. No requestAnimationFrame/timer callback was scheduled.
    expect(scheduledFrames).toHaveLength(0);

    // C. The streaming message text reflects the flushed delta
    const lastMessage = appState.messages[appState.messages.length - 1];
    expect(lastMessage?.text).toBe('Partial delta-data');
  });

  // ————————————————————————————————————————————————————————————————
  // Run activity wiring
  // ————————————————————————————————————————————————————————————————
  it('does not pretend the model is connecting before Host accepts the run', () => {
    const userMessage = createUserMessage('u-pending', 'with images');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMessage]}
            streaming={true}
            activeRunId={null}
            editingMessageId={null}
            lastUserMessageId={userMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="run-activity-slot"]')).toBeNull();
    expect(container.textContent).not.toContain('Connecting to model…');
    expect(container.querySelector('[data-testid="assembly-summary-capsule"]')).toBeNull();
  });

  it('renders run-activity slot when streaming and the last message is from the user', () => {
    const userMessage = createUserMessage('u1', 'Hello');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMessage]}
            streaming={true}
            activeRunId="run-1"
            editingMessageId={null}
            lastUserMessageId={userMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    const slot = container.querySelector('[data-testid="run-activity-slot"]');
    expect(slot).not.toBeNull();
    expect(slot?.textContent).toContain('Connecting to model…');
    expect(slot?.closest('[data-testid="current-response-turn"]')).not.toBeNull();
  });

  it('renders the run-activity slot when the optimistic transcript is still empty', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[]}
            streaming={true}
            activeRunId="run-empty"
            editingMessageId={null}
            lastUserMessageId={null}
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    const slot = container.querySelector('[data-testid="run-activity-slot"]');
    expect(slot).not.toBeNull();
    expect(slot?.textContent).toContain('Connecting to model…');
    expect(slot?.closest('[data-testid="current-response-turn"]')).not.toBeNull();
  });

  it('keeps run-activity slot through the empty assistant lifecycle, then drops it on first token', () => {
    const userMessage = createUserMessage('u2', 'Hello');
    const renderWith = (messages: ChatMessageUi[]): void => {
      act(() => {
        root.render(
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ChatThreadHarness
              messages={messages}
              streaming={true}
              activeRunId="run-1"
              editingMessageId={null}
              lastUserMessageId={userMessage.id}
              activeTheme={null}
              artifactThemeKey={0}
              onEdit={noop}
              onCancelEdit={noop}
              onEditResend={noop}
              onRetry={noop}
              onInspectSubagent={undefined}
              composerCard={composerCard}
              locale="en"
            />
          </PiwinUiProvider>,
        );
      });
    };

    renderWith([userMessage]);
    expect(container.querySelector('[data-testid="run-activity-slot"]')).not.toBeNull();

    // A model that hides its reasoning opens this bubble and then stays silent;
    // the locator has to survive or the turn looks frozen.
    const pendingAssistant = createStreamingAssistant('a1');
    renderWith([userMessage, pendingAssistant]);
    expect(container.querySelector('[data-testid="run-activity-slot"]')).not.toBeNull();

    renderWith([userMessage, { ...pendingAssistant, text: 'Here we go' }]);
    expect(container.querySelector('[data-testid="run-activity-slot"]')).toBeNull();
  });

  it('drops the run-activity slot once the pending assistant lifecycle runs a tool', () => {
    const userMessage = createUserMessage('u2-tool', 'Hello');
    const toolAssistant: ChatMessageUi = {
      ...createStreamingAssistant('a1-tool'),
      tools: [{ toolCallId: 'tool-1', toolName: 'bash', status: 'running', output: '' }],
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMessage, toolAssistant]}
            streaming={true}
            activeRunId="run-1"
            editingMessageId={null}
            lastUserMessageId={userMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="run-activity-slot"]')).toBeNull();
  });

  it('renders one inline caret for a run with multiple assistant lifecycles', () => {
    const userMessage = createUserMessage('u-caret', 'Check the update');
    const answerMessage: ChatMessageUi = {
      id: 'a-caret-text',
      role: 'assistant',
      text: '已找到更新地址。',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      runId: 'run-caret',
    };
    const emptyLifecycleMessage: ChatMessageUi = {
      id: 'a-caret-empty',
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'streaming',
      runId: 'run-caret',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMessage, answerMessage, emptyLifecycleMessage]}
            streaming={true}
            editingMessageId={null}
            lastUserMessageId={userMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            activeRunId="run-caret"
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelectorAll('[data-testid="message-bubble"] .markdown')).toHaveLength(1);
    expect(
      container.querySelectorAll(
        '[data-testid="message-bubble"] .markdown.has-stream-caret',
      ),
    ).toHaveLength(1);
  });

  it('folds consecutive read/search steps into one explore capsule and hides member bubbles', () => {
    const userMessage = createUserMessage('u-flow', 'Find the config loader');
    const readStep = (id: string, toolCallId: string, path: string): ChatMessageUi => ({
      id,
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [
        {
          toolCallId,
          toolName: 'read',
          status: 'done',
          output: 'contents',
          presentation: {
            kind: 'filesystem',
            title: 'Read',
            actionVerb: 'Read',
            targetPaths: [path],
          },
        },
      ],
      attachments: [],
      status: 'done',
      runId: 'run-flow',
    });
    const searchStep: ChatMessageUi = {
      id: 'a-flow-search',
      role: 'assistant',
      text: '',
      thinking: 'narrow down the loader',
      thinkingStartedAt: 1_000,
      thinkingEndedAt: 4_000,
      tools: [
        {
          toolCallId: 'tool-grep',
          toolName: 'grep',
          status: 'done',
          output: 'matches',
          presentation: {
            kind: 'filesystem',
            title: 'Search',
            actionVerb: 'Searched',
            summary: 'loadConfig',
          },
        },
      ],
      attachments: [],
      status: 'done',
      runId: 'run-flow',
    };
    const answer: ChatMessageUi = {
      id: 'a-flow-answer',
      role: 'assistant',
      text: 'The loader lives in config.ts.',
      thinking: 'confirm the answer',
      tools: [],
      attachments: [],
      status: 'done',
      runId: 'run-flow',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[
              userMessage,
              readStep('a-flow-read-1', 'tool-read-1', 'src/a.ts'),
              searchStep,
              readStep('a-flow-read-2', 'tool-read-2', 'src/b.ts'),
              answer,
            ]}
            workDetailsExpanded="always"
            streaming={false}
            editingMessageId={null}
            lastUserMessageId={userMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    // One collapsed capsule owns the whole exploration; member bubbles vanish.
    const capsules = container.querySelectorAll('[data-testid="explore-flow-capsule"]');
    expect(capsules).toHaveLength(1);
    expect(capsules[0]?.getAttribute('data-expanded')).toBe('false');
    expect(capsules[0]?.textContent).toContain('Explored 2 files · 1 search');
    expect(container.querySelectorAll('[data-testid="message-bubble"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="tool-call-card"]')).toBeNull();
    // The answer's own thought row is folded into the capsule, not duplicated.
    expect(container.querySelectorAll('[data-testid="turn-work-details-summary"]')).toHaveLength(0);

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="explore-flow-header"]')
        ?.click();
    });
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-testid="explore-thought-row"]')).toHaveLength(2);
    expect(container.textContent).toContain('Thought for 3s');
  });

  it('renders every response segment in causal order without a Run summary', () => {
    const userMessage = createUserMessage('u-run-work', 'Create the SVG');
    const firstAssistant: ChatMessageUi = {
      id: 'a-run-first',
      role: 'assistant',
      text: 'I will inspect the workspace.',
      thinking: 'inspect the existing files',
      tools: [{ toolCallId: 'tool-read', toolName: 'bash', status: 'done', output: 'files' }],
      attachments: [],
      status: 'done',
      runId: 'run-work',
    };
    const thinkingOnlyAssistant: ChatMessageUi = {
      id: 'a-run-thinking-only',
      role: 'assistant',
      text: '',
      thinking: 'prepare a new drawing',
      tools: [],
      attachments: [],
      status: 'done',
      runId: 'run-work',
    };
    const writeAssistant: ChatMessageUi = {
      id: 'a-run-write',
      role: 'assistant',
      text: 'Saving the SVG.',
      thinking: '',
      tools: [
        { toolCallId: 'tool-write', toolName: 'write_file', status: 'done', output: 'saved' },
      ],
      attachments: [],
      status: 'done',
      runId: 'run-work',
    };
    const finalAssistant: ChatMessageUi = {
      id: 'a-run-final',
      role: 'assistant',
      text: 'The SVG is ready.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      runId: 'run-work',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[
              userMessage,
              firstAssistant,
              thinkingOnlyAssistant,
              writeAssistant,
              finalAssistant,
            ]}
            streaming={false}
            editingMessageId={null}
            lastUserMessageId={userMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            workDetailsExpanded="always"
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelectorAll('[data-testid="turn-work-details"]')).toHaveLength(3);
    const firstRow = container.querySelector('#msg-a-run-first');
    const thinkingRow = container.querySelector('#msg-a-run-thinking-only');
    const writeRow = container.querySelector('#msg-a-run-write');
    const finalRow = container.querySelector('#msg-a-run-final');
    expect(firstRow?.textContent).toContain('inspect the existing files');
    expect(firstRow?.querySelector('.markdown')).toBeNull();
    expect(firstRow?.textContent).not.toContain('I will inspect the workspace.');
    expect(thinkingRow?.textContent).toContain('prepare a new drawing');
    expect(writeRow?.querySelector('.markdown')).toBeNull();
    expect(finalRow?.textContent).toContain('The SVG is ready.');
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="activity-call-chain-summary"]')).toBeNull();
    expect(container.querySelector('[data-testid="run-inspector-inline"]')).toBeNull();
    expect(firstRow?.compareDocumentPosition(thinkingRow as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(thinkingRow?.compareDocumentPosition(writeRow as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(writeRow?.compareDocumentPosition(finalRow as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(container.textContent).toContain('The SVG is ready.');
  });

  it('keeps an earlier tool container mounted when the next response arrives', () => {
    const userMessage = createUserMessage('u-inspector-stability', 'Inspect the project');
    const firstAssistant: ChatMessageUi = {
      id: 'a-inspector-first',
      role: 'assistant',
      text: 'I will inspect the project.',
      thinking: '',
      tools: [{ toolCallId: 'tool-inspector-first', toolName: 'read', status: 'done', output: '' }],
      attachments: [],
      status: 'done',
      runId: 'run-inspector-stability',
    };
    const renderThread = (messages: ChatMessageUi[]): void => {
      act(() => {
        root.render(
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ChatThreadHarness
              messages={messages}
              streaming={false}
              editingMessageId={null}
              lastUserMessageId={userMessage.id}
              activeTheme={null}
              artifactThemeKey={0}
              workDetailsExpanded="always"
              onEdit={noop}
              onCancelEdit={noop}
              onEditResend={noop}
              onRetry={noop}
              onInspectSubagent={undefined}
              composerCard={composerCard}
              locale="en"
            />
          </PiwinUiProvider>,
        );
      });
    };

    renderThread([userMessage, firstAssistant]);
    const firstToolCard = container.querySelector(
      '#msg-a-inspector-first [data-testid="tool-call-card"]',
    );
    expect(firstToolCard).not.toBeNull();

    const nextAssistant: ChatMessageUi = {
      id: 'a-inspector-next',
      role: 'assistant',
      text: 'The project is ready.',
      thinking: '',
      tools: [{ toolCallId: 'tool-inspector-next', toolName: 'write', status: 'done', output: '' }],
      attachments: [],
      status: 'done',
      runId: 'run-inspector-stability',
    };
    renderThread([userMessage, firstAssistant, nextAssistant]);

    expect(container.querySelector('#msg-a-inspector-first [data-testid="tool-call-card"]')).toBe(
      firstToolCard,
    );
    expect(container.querySelector('[data-testid="run-inspector-inline"]')).toBeNull();
    expect(
      firstToolCard?.compareDocumentPosition(
        container.querySelector('#msg-a-inspector-next') as Node,
      ) ?? 0,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(2);
  });

  it('keeps tool-only lifecycle rows as ordered transcript events', () => {
    // Each Pi tool step is a real event position. Compact cards keep it
    // scannable without moving those calls into a later response.
    const userMessage = createUserMessage('u-tools-inflate', 'Inspect packaging');
    const owner: ChatMessageUi = {
      id: 'a-owner',
      role: 'assistant',
      text: '',
      thinking: 'plan the inspection',
      tools: [{ toolCallId: 'tool-1', toolName: 'bash', status: 'done', output: 'ok' }],
      attachments: [],
      status: 'done',
      runId: 'run-inflate',
    };
    const toolOnlySteps: ChatMessageUi[] = Array.from({ length: 15 }, (_, index) => ({
      id: `a-tool-step-${index}`,
      role: 'assistant' as const,
      text: '',
      thinking: '',
      tools: [
        {
          toolCallId: `tool-step-${index}`,
          toolName: 'bash',
          status: 'done' as const,
          output: `step ${index}`,
        },
      ],
      attachments: [],
      status: 'done' as const,
      runId: 'run-inflate',
    }));
    const finalReply: ChatMessageUi = {
      id: 'a-final-body',
      role: 'assistant',
      text: 'I need to ground the plan in the actual packaging setup.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      runId: 'run-inflate',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMessage, owner, ...toolOnlySteps, finalReply]}
            streaming={false}
            editingMessageId={null}
            lastUserMessageId={userMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            workDetailsExpanded="always"
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    for (let index = 0; index < 15; index += 1) {
      expect(container.querySelector(`#msg-a-tool-step-${index}`)).not.toBeNull();
    }
    expect(container.querySelector('#msg-a-owner')).not.toBeNull();
    expect(container.querySelector('#msg-a-final-body')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="message-bubble"]')).toHaveLength(18);
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(16);
    expect(container.querySelector('[data-testid="activity-call-chain"]')).toBeNull();
    expect(container.textContent).toContain('I need to ground the plan');
  });

  it('removes run-activity slot when permissionPrompt is present or streaming is false', () => {
    const userMessage = createUserMessage('u3', 'Hello');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMessage]}
            streaming={true}
            activeRunId="run-1"
            editingMessageId={null}
            lastUserMessageId={userMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            permissionPrompt={null}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="run-activity-slot"]')).not.toBeNull();

    const permissionPrompt: PermissionPromptUi = {
      requestId: 'p1',
      sessionId: 's1',
      action: 'bash',
      detail: 'ls -la',
      defaultDecision: 'allow',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMessage]}
            streaming={true}
            editingMessageId={null}
            lastUserMessageId={userMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            permissionPrompt={permissionPrompt}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="run-activity-slot"]')).toBeNull();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMessage]}
            streaming={false}
            editingMessageId={null}
            lastUserMessageId={userMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            permissionPrompt={null}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="run-activity-slot"]')).toBeNull();
  });

  it('passes locale through ChatThread → ChatMessageRow → TurnWorkDetails', () => {
    const assistantMessage = createStreamingAssistant('a2');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[assistantMessage]}
            streaming={true}
            editingMessageId={null}
            lastUserMessageId={null}
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    const waitingLine = container.querySelector('[data-testid="turn-waiting-line"]');
    expect(waitingLine).not.toBeNull();
    expect(waitingLine?.textContent).toContain('Connecting to model…');
  });

  it('renders time display, copy button, and revert button on user messages', async () => {
    const onRetrySpy = vi.fn();
    const onFeedbackSpy = vi.fn();
    const userMsg: ChatMessageUi = {
      id: 'msg-u1',
      role: 'user',
      text: 'Test user prompt for actions bar',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: '2026-07-31T13:53:00.000Z',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMsg]}
            streaming={false}
            editingMessageId={null}
            lastUserMessageId="msg-u1"
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={onRetrySpy}
            onFeedback={onFeedbackSpy}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    const timeEl = container.querySelector('[data-testid="user-message-time"]');
    expect(timeEl).not.toBeNull();

    const copyBtn = container.querySelector(
      '[data-testid="message-copy-btn"]',
    ) as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();

    const revertBtn = container.querySelector(
      '[data-testid="message-revert-btn"]',
    ) as HTMLButtonElement;
    expect(revertBtn).not.toBeNull();

    // Revert button click triggers onRetry with message id
    act(() => {
      revertBtn.click();
    });
    expect(onRetrySpy).toHaveBeenCalledWith('msg-u1');
  });

  it('renders the branch switcher on the active sibling head and switches on click', () => {
    const onSwitchBranch = vi.fn();
    const point: TranscriptBranchPoint = {
      anchorMessageId: 'a1',
      activeIndex: 0,
      siblings: [
        {
          headMessageId: 'msg-u1',
          preview: 'first',
          leafPreview: 'first',
          messageCount: 1,
          writesWorkspace: false,
          updatedAt: '2026-07-31T13:53:00.000Z',
        },
        {
          headMessageId: 'msg-u1-b',
          preview: 'second',
          leafPreview: 'second',
          messageCount: 1,
          writesWorkspace: true,
          updatedAt: '2026-07-31T13:54:00.000Z',
        },
      ],
    };
    const userMsg: ChatMessageUi = {
      id: 'msg-u1',
      role: 'user',
      text: 'first',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMsg]}
            streaming={false}
            editingMessageId={null}
            lastUserMessageId="msg-u1"
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            branchPoints={[point]}
            onSwitchBranch={onSwitchBranch}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="message-branch-label"]')?.textContent).toBe(
      '1/2',
    );
    act(() => {
      (container.querySelector('[data-testid="message-branch-next"]') as HTMLButtonElement).click();
    });
    expect(onSwitchBranch).toHaveBeenCalledWith('msg-u1-b');
  });

  it('shows edit and cancel controls for a pending run adjustment', () => {
    const onEdit = vi.fn();
    const onInterventionCancel = vi.fn();
    const userMsg: ChatMessageUi = {
      id: 'msg-intervention',
      role: 'user',
      text: 'Use the smaller fix',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: 'intervention-1',
        status: 'pending',
        targetRunId: 'run-1',
        revision: 1,
      },
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMsg]}
            streaming={true}
            editingMessageId={null}
            lastUserMessageId="msg-intervention"
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={onEdit}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInterventionEdit={noop}
            onInterventionCancel={onInterventionCancel}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="intervention-delivery-status"]')?.textContent).toContain(
      '等待当前步骤完成',
    );
    const editButton = container.querySelector(
      '[data-testid="intervention-edit-btn"]',
    ) as HTMLButtonElement;
    const cancelButton = container.querySelector(
      '[data-testid="intervention-cancel-btn"]',
    ) as HTMLButtonElement;
    act(() => editButton.click());
    act(() => cancelButton.click());
    expect(onEdit).toHaveBeenCalledWith('msg-intervention');
    expect(onInterventionCancel).toHaveBeenCalledWith('msg-intervention');
  });

  it('keeps pending queued turns out of the transcript until they start', () => {
    const queuedMessage: ChatMessageUi = {
      id: 'msg-queued',
      role: 'user',
      text: 'This belongs in the next-turn queue',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      instructionDelivery: {
        kind: 'queued-turn',
        instructionId: 'queued-1',
        status: 'pending',
        revision: 1,
      },
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[queuedMessage]}
            streaming={true}
            editingMessageId={null}
            lastUserMessageId={queuedMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).not.toContain(queuedMessage.text);
    expect(container.querySelector('[data-testid="message-bubble"]')).toBeNull();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[{
              ...queuedMessage,
              instructionDelivery: {
                kind: 'queued-turn',
                instructionId: 'queued-1',
                status: 'started',
                targetRunId: 'run-queued',
                revision: 2,
              },
            }]}
            streaming={true}
            editingMessageId={null}
            lastUserMessageId={queuedMessage.id}
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain(queuedMessage.text);
    expect(container.querySelector('[data-testid="message-bubble"]')).not.toBeNull();
  });

  it('collapses user image attachments with the message body by default', () => {
    const userMessageWithImage: ChatMessageUi = {
      id: 'msg-image-history',
      role: 'user',
      text: 'What is this?',
      thinking: '',
      tools: [],
      attachments: [
        {
          id: 'attachment-image',
          kind: 'media',
          path: '/tmp/history-image.png',
          mimeType: 'image/png',
          byteSize: 1024,
          source: 'paste',
        },
      ],
      status: 'done',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[userMessageWithImage]}
            streaming={false}
            editingMessageId={null}
            lastUserMessageId={userMessageWithImage.id}
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    const collapsibleBody = container.querySelector<HTMLElement>(
      '[data-testid="user-message-collapsible-body"]',
    );
    const attachmentContainer = container.querySelector('.message-attachments');

    expect(collapsibleBody).not.toBeNull();
    expect(collapsibleBody?.classList.contains('is-collapsed')).toBe(true);
    expect(collapsibleBody?.contains(attachmentContainer)).toBe(true);

    act(() => {
      collapsibleBody?.click();
    });

    expect(collapsibleBody?.classList.contains('is-expanded')).toBe(true);
  });

  it('shows image generation running, completed, and failed states', () => {
    const generatedAttachment = {
      id: 'generated-image-1',
      kind: 'media' as const,
      path: '/tmp/generated-image-1.png',
      mimeType: 'image/png',
      byteSize: 2048,
      source: 'generated' as const,
    };
    const imageTool: ToolCardUi = {
      toolCallId: 'image-tool-1',
      toolName: 'image_gen',
      status: 'running',
      output: '',
    };
    const runningMessage: ChatMessageUi = {
      id: 'image-generation-running',
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [imageTool],
      attachments: [],
      status: 'streaming',
    };
    const completedMessage: ChatMessageUi = {
      ...runningMessage,
      text: 'Here is the generated image.',
      tools: [{ ...imageTool, status: 'done' }],
      attachments: [generatedAttachment],
      status: 'done',
    };
    const failedMessage: ChatMessageUi = {
      ...runningMessage,
      tools: [
        {
          ...imageTool,
          status: 'error',
          output: 'provider returned HTTP 500',
        },
      ],
      status: 'error',
    };

    function renderMessage(message: ChatMessageUi): void {
      act(() => {
        root.render(
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ChatThreadHarness
              messages={[message]}
              streaming={message.status === 'streaming'}
              editingMessageId={null}
              lastUserMessageId={null}
              activeTheme={null}
              artifactThemeKey={0}
              onEdit={noop}
              onCancelEdit={noop}
              onEditResend={noop}
              onRetry={noop}
              onInspectSubagent={undefined}
              composerCard={composerCard}
              locale="en"
            />
          </PiwinUiProvider>,
        );
      });
    }

    renderMessage(runningMessage);
    expect(container.querySelector('[data-testid="image-generation-progress"]')).toMatchObject({
      textContent: expect.stringContaining('Generating image'),
    });
    expect(
      container
        .querySelector('[data-testid="image-generation-progress"]')
        ?.getAttribute('data-tool-status'),
    ).toBe('running');

    renderMessage(completedMessage);
    expect(container.querySelector('[data-testid="image-generation-progress"]')).toBeNull();
    expect(container.querySelector('.message-attachments')).not.toBeNull();

    renderMessage(failedMessage);
    expect(container.querySelector('[data-testid="image-generation-progress"]')).toMatchObject({
      textContent: expect.stringContaining('Image generation failed'),
    });
    expect(
      container
        .querySelector('[data-testid="image-generation-progress"]')
        ?.getAttribute('data-tool-status'),
    ).toBe('error');
    expect(container.querySelector('[data-testid="tool-call-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="activity-call-chain-failure"]')).toBeNull();

    renderMessage({
      ...runningMessage,
      id: 'video-generation-running',
      tools: [{ ...imageTool, toolCallId: 'video-tool-1', toolName: 'video_gen' }],
    });
    expect(container.querySelector('[data-testid="video-generation-progress"]')).not.toBeNull();
  });

  it('renders routed generation calls once and keeps non-generation toolbox calls generic', () => {
    function renderTool(tool: ToolCardUi): void {
      const message: ChatMessageUi = {
        id: `message-${tool.toolCallId}`,
        role: 'assistant',
        text: '',
        thinking: '',
        tools: [tool],
        attachments: [],
        status: tool.status === 'running' ? 'streaming' : tool.status,
      };
      act(() => {
        root.render(
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ChatThreadHarness
              messages={[message]}
              streaming={message.status === 'streaming'}
              editingMessageId={null}
              lastUserMessageId={null}
              activeTheme={null}
              artifactThemeKey={0}
              onEdit={noop}
              onCancelEdit={noop}
              onEditResend={noop}
              onRetry={noop}
              onInspectSubagent={undefined}
              composerCard={composerCard}
              locale="en"
            />
          </PiwinUiProvider>,
        );
      });
    }

    renderTool({
      toolCallId: 'routed-image',
      toolName: 'piwin_toolbox',
      status: 'running',
      output: '',
      presentation: {
        kind: 'image',
        title: 'image_gen',
        routedToolName: 'image_gen',
        actionVerb: 'Generated image',
        summary: 'a red cube',
      },
    });
    expect(container.querySelector('[data-testid="image-generation-progress"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tool-call-card"]')).toBeNull();

    renderTool({
      toolCallId: 'routed-video',
      toolName: 'piwin_toolbox',
      status: 'error',
      output: 'provider failed',
      presentation: {
        kind: 'video',
        title: 'video_gen',
        routedToolName: 'video_gen',
        actionVerb: 'Generated video',
        error: { category: 'execution', message: 'provider failed' },
      },
    });
    expect(container.querySelector('[data-testid="video-generation-progress"]')).toMatchObject({
      textContent: expect.stringContaining('Video generation failed'),
    });
    expect(container.querySelector('[data-testid="tool-call-card"]')).toBeNull();

    renderTool({
      toolCallId: 'routed-process',
      toolName: 'piwin_toolbox',
      status: 'running',
      output: '',
      presentation: {
        kind: 'process',
        title: 'process_start',
        routedToolName: 'process_start',
        actionVerb: 'process_start',
      },
    });
    expect(container.querySelector('[data-testid="image-generation-progress"]')).toBeNull();
    expect(container.querySelector('[data-testid="video-generation-progress"]')).toBeNull();
    expect(container.querySelector('[data-testid="tool-call-card"]')).not.toBeNull();
  });

  it('renders native citations for live and hydrated assistant messages only', () => {
    const evidence = {
      query: 'piwin',
      provenance: 'native' as const,
      citations: [
        {
          title: 'Piwin docs',
          url: 'https://example.com/piwin',
          snippet: 'A normalized citation.',
          provenance: 'native' as const,
        },
      ],
    };
    const liveMessage: ChatMessageUi = {
      ...createStreamingAssistant('native-live'),
      text: 'Grounded answer',
      status: 'done',
      searchEvidence: evidence,
    };
    const [hydratedMessage] = mapTranscriptMessagesToUi([
      {
        id: 'native-hydrated',
        role: 'assistant',
        text: 'Hydrated answer',
        createdAt: '2026-08-10T00:00:00.000Z',
        status: 'done',
        searchEvidence: evidence,
      },
    ]);

    function renderMessage(message: ChatMessageUi | undefined): void {
      if (!message) throw new Error('expected hydrated message');
      act(() => {
        root.render(
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <ChatThreadHarness
              messages={[message]}
              streaming={false}
              editingMessageId={null}
              lastUserMessageId={null}
              activeTheme={null}
              artifactThemeKey={0}
              onEdit={noop}
              onCancelEdit={noop}
              onEditResend={noop}
              onRetry={noop}
              onInspectSubagent={undefined}
              composerCard={composerCard}
              locale="en"
            />
          </PiwinUiProvider>,
        );
      });
    }

    renderMessage(liveMessage);
    expect(container.querySelector('[data-testid="native-search-citations"]')).toMatchObject({
      textContent: expect.stringContaining('Native search'),
    });
    expect(container.querySelector('.citation-url')?.textContent).toBe('https://example.com/piwin');
    expect(container.querySelector('.citation-snippet')?.textContent).toContain(
      'A normalized citation.',
    );

    renderMessage(hydratedMessage);
    expect(container.querySelector('[data-testid="native-search-citations"]')).not.toBeNull();

    renderMessage({
      ...liveMessage,
      id: 'native-empty',
      searchEvidence: { provenance: 'native', citations: [] },
    });
    expect(container.querySelector('[data-testid="native-search-citations"]')).toBeNull();
  });

  it('updates existing thinking details when verbose Agent chat changes', () => {
    const assistantMessage: ChatMessageUi = {
      id: 'thinking-visibility-a1',
      role: 'assistant',
      text: 'The implementation is complete.',
      thinking: 'Reviewing the implementation details.',
      tools: [],
      attachments: [],
      status: 'done',
    };
    const runRecordsById = {};

    function renderThread(showThinking: boolean): void {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[assistantMessage]}
            streaming={false}
            editingMessageId={null}
            lastUserMessageId={null}
            activeTheme={null}
            artifactThemeKey={0}
            runRecordsById={runRecordsById}
            showThinking={showThinking}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    }

    act(() => {
      renderThread(false);
    });
    expect(container.querySelector('[data-testid="turn-work-details-summary"]')).toBeNull();

    act(() => {
      renderThread(true);
    });
    const summary = container.querySelector<HTMLElement>(
      '[data-testid="turn-work-details-summary"]',
    );
    expect(summary).not.toBeNull();
    expect(container.querySelector('[data-testid="turn-thinking"]')).toBeNull();

    act(() => {
      summary?.click();
    });
    expect(container.querySelector('[data-testid="turn-thinking"]')?.textContent).toContain(
      'Reviewing the implementation details.',
    );
  });

  it('stops the thought timer during tool work and shows the fixed interval at completion', () => {
    const assistantMessage: ChatMessageUi = {
      id: 'thinking-timer-a1',
      role: 'assistant',
      text: '',
      thinking: 'Reviewing the implementation details.',
      thinkingStartedAt: 1_000,
      thinkingEndedAt: 5_000,
      tools: [{ toolCallId: 'tool-1', toolName: 'read', status: 'done', output: '' }],
      attachments: [],
      status: 'done',
      runId: 'run-thinking-timer',
    };

    function renderThread(activeRunId: string | null, endedAt: number | null): void {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[assistantMessage]}
            streaming={activeRunId !== null}
            editingMessageId={null}
            lastUserMessageId={null}
            activeTheme={null}
            artifactThemeKey={0}
            activeRunId={activeRunId}
            runRecordsById={{
              'run-thinking-timer': {
                runId: 'run-thinking-timer',
                phaseHistory: [{ phase: 'tool-running', at: 6_000 }],
                startedAt: 500,
                endedAt,
                ...(endedAt !== null ? { outcome: 'completed' as const } : {}),
              },
            }}
            showThinking
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    }

    act(() => renderThread('run-thinking-timer', null));
    let summary = container.querySelector<HTMLElement>('[data-testid="turn-work-details-summary"]');
    expect(summary?.textContent).toContain('正在处理…');
    expect(summary?.textContent).not.toContain('已思考');
    expect(container.querySelector('[data-testid="turn-summary-active-animation"]')).toBeNull();

    act(() => renderThread(null, 1_707_000));
    summary = container.querySelector<HTMLElement>('[data-testid="turn-work-details-summary"]');
    expect(summary?.textContent).toContain('已思考 4 秒');
    expect(summary?.textContent).not.toContain('1707');
  });

  it('uses the compact shared radial animation for active thinking', () => {
    const activeMessage: ChatMessageUi = {
      id: 'thinking-animation-a1',
      role: 'assistant',
      text: '',
      thinking: 'Reviewing the implementation details.',
      tools: [],
      attachments: [],
      status: 'streaming',
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[activeMessage]}
            streaming
            editingMessageId={null}
            lastUserMessageId={null}
            activeTheme={null}
            artifactThemeKey={0}
            runRecordsById={{}}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={composerCard}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="turn-thinking"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="turn-work-details"]')?.getAttribute('data-open'),
    ).toBe('false');
    expect(container.querySelector('[data-testid="turn-summary-active-animation"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="turn-summary-radial-bellow"]')).toMatchObject({
      className: expect.stringContaining('ui-anim--sm'),
    });
  });

  it('Goal Abort stops the in-flight run and exits goal mode', () => {
    const onAbort = vi.fn();
    const onAgentModeChange = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={[createUserMessage('u-goal', 'Ship it')]}
            streaming
            editingMessageId={null}
            lastUserMessageId="u-goal"
            activeTheme={null}
            artifactThemeKey={0}
            onEdit={noop}
            onCancelEdit={noop}
            onEditResend={noop}
            onRetry={noop}
            onInspectSubagent={undefined}
            composerCard={{
              ...composerCard,
              agentMode: 'goal',
              streaming: true,
              onAbort,
              onAgentModeChange,
            }}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="goal-sticky-strip"]')).not.toBeNull();
    const abortButton =
      container.querySelector('[data-testid="goal-abort-btn"]') ??
      Array.from(container.querySelectorAll('button')).find((element) =>
        /Abort|终止/.test(element.textContent ?? ''),
      );
    expect(abortButton).toBeTruthy();
    act(() => {
      (abortButton as HTMLButtonElement).click();
    });
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAgentModeChange).toHaveBeenCalledWith('agent');
  });
});

// ---------------------------------------------------------------------------
// Shared noop — avoids inline function allocations in Profiler subtrees
// ---------------------------------------------------------------------------

function noop(): void {
  /* intentional noop for callback props */
}

describe('Conversation ChatThread presentation (CHT-401~407)', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderConversation(messages: ChatMessageUi[], extras: Partial<Parameters<typeof ChatThread>[0]> = {}): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThreadHarness
            messages={messages}
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
            isConversationSession
            {...extras}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders content-first Conversation answers without Agent work details', () => {
    const userMessage = createUserMessage('u-chat', 'search this');
    const searchCall: ChatMessageUi = {
      id: 'a-chat-search',
      role: 'assistant',
      text: '我先去搜索相关资料。',
      thinking: 'I should search first',
      tools: [
        { toolCallId: 'tool-web', toolName: 'web_search', status: 'done', output: 'hits' },
      ],
      attachments: [],
      status: 'done',
    };
    const assistant: ChatMessageUi = {
      id: 'a-chat',
      role: 'assistant',
      text: 'Here is the answer.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      searchEvidence: {
        query: 'search this',
        provenance: 'external',
        citations: [
          {
            title: 'Example',
            url: 'https://example.com',
            provenance: 'external',
          },
        ],
      },
    };
    renderConversation([userMessage, searchCall, assistant], {
      plan: {
        id: 'plan-1',
        sessionId: 's-chat',
        projectPath: '/tmp/unused',
        title: 'Hidden plan',
        status: 'approved',
        steps: [],
        goal: 'unused',
        revision: 1,
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
        source: 'user',
      },
    });

    expect(container.querySelector('[data-testid="conversation-response"]')).not.toBeNull();
    expect(container.textContent).toContain('Here is the answer.');
    expect(container.textContent).not.toContain('我先去搜索相关资料。');
    expect(container.querySelector('#msg-a-chat-search .markdown')).toBeNull();
    expect(container.querySelector('[data-testid="turn-work-details"]')).toBeNull();
    expect(container.querySelector('[data-testid="turn-tool-group"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tool-call-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="turn-thinking"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-locator"]')).toBeNull();
    expect(container.querySelector('[data-testid="files-changed-bar"]')).toBeNull();
    expect(container.querySelector('[data-testid="plan-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="assembly-summary-capsule"]')).toBeNull();
    expect(container.textContent).toContain('Example');
    expect(searchCall.tools).toHaveLength(1);
  });

  it('renders thinking in conversation mode and keeps generation progress', () => {
    const userMessage = createUserMessage('u-legacy', 'draw something');
    const thinkingOnly: ChatMessageUi = {
      id: 'a-legacy-think',
      role: 'assistant',
      text: '',
      thinking: 'raw thought that must stay in the reducer',
      tools: [],
      attachments: [],
      status: 'done',
    };
    const generated: ChatMessageUi = {
      id: 'a-legacy-image',
      role: 'assistant',
      text: 'Here is the image.',
      thinking: '',
      tools: [{ toolCallId: 'tool-image', toolName: 'image_gen', status: 'done', output: 'ok' }],
      attachments: [],
      status: 'done',
    };
    renderConversation([userMessage, thinkingOnly, generated]);

    expect(container.querySelector('#msg-a-legacy-think')).toBeNull();
    expect(container.querySelector('#msg-a-legacy-image')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="conversation-message-header"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="image-generation-progress"]')).not.toBeNull();
    expect(thinkingOnly.thinking).toBe('raw thought that must stay in the reducer');
  });

  it('uses one identity header for a Conversation tool-loop turn', () => {
    const userMessage = createUserMessage('u-fetch', 'read the page');
    const firstCall: ChatMessageUi = {
      id: 'a-fetch-think',
      role: 'assistant',
      text: '',
      thinking: 'I will fetch the URL',
      tools: [{ toolCallId: 'tool-fetch', toolName: 'web_fetch', status: 'done', output: 'ok' }],
      attachments: [],
      status: 'done',
      createdAt: '2026-08-20T13:25:00.000Z',
      model: { protocol: 'openai-compatible', providerId: 'cpa', modelId: 'glm5.2' },
    };
    const finalReply: ChatMessageUi = {
      id: 'a-fetch-final',
      role: 'assistant',
      text: '页首内容已读取。',
      thinking: 'summarize the page',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: '2026-08-20T13:25:00.000Z',
      model: { protocol: 'openai-compatible', providerId: 'cpa', modelId: 'glm5.2' },
    };
    renderConversation([userMessage, firstCall, finalReply]);

    expect(container.querySelector('#msg-a-fetch-think')).not.toBeNull();
    expect(container.querySelector('#msg-a-fetch-final')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="conversation-message-header"]')).toHaveLength(1);
    expect(
      container.querySelector('#msg-a-fetch-think [data-testid="conversation-message-model-name"]')
        ?.textContent,
    ).toBe('glm5.2');
  });

  it('inherits model snapshot from later assistant message in the same Conversation turn', () => {
    const userMessage = createUserMessage('u-fetch-2', 'read the page');
    const firstCallNoModel: ChatMessageUi = {
      id: 'a-fetch-think-nomodel',
      role: 'assistant',
      text: '',
      thinking: 'I will fetch the URL',
      tools: [{ toolCallId: 'tool-fetch-2', toolName: 'web_fetch', status: 'done', output: 'ok' }],
      attachments: [],
      status: 'done',
      createdAt: '2026-08-20T13:25:00.000Z',
    };
    const finalReplyWithModel: ChatMessageUi = {
      id: 'a-fetch-final-withmodel',
      role: 'assistant',
      text: '页首内容已读取。',
      thinking: 'summarize the page',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: '2026-08-20T13:25:00.000Z',
      model: { protocol: 'openai-compatible', providerId: 'google', modelId: 'gemini-3.7-flash' },
    };
    renderConversation([userMessage, firstCallNoModel, finalReplyWithModel]);

    expect(
      container.querySelector('#msg-a-fetch-think-nomodel [data-testid="conversation-message-header"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('#msg-a-fetch-think-nomodel [data-testid="conversation-message-model-name"]')
        ?.textContent,
    ).toBe('gemini-3.7-flash');
  });

  it('falls back to livePromptModel on the identity header of the latest Conversation turn', () => {
    const userMessage = createUserMessage('u-fetch-3', 'generate something');
    const firstCall: ChatMessageUi = {
      id: 'a-tool-call',
      role: 'assistant',
      text: '',
      thinking: 'preparing tool',
      tools: [{ toolCallId: 'tool-art', toolName: 'artifact_instructions', status: 'done', output: 'ok' }],
      attachments: [],
      status: 'done',
      createdAt: '2026-08-20T13:25:00.000Z',
    };
    const finalReply: ChatMessageUi = {
      id: 'a-tool-reply',
      role: 'assistant',
      text: 'Here is your animation.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: '2026-08-20T13:25:00.000Z',
    };
    renderConversation([userMessage, firstCall, finalReply], {
      livePromptModel: {
        protocol: 'openai-compatible',
        providerId: 'google',
        modelId: 'gemini-3.7-flash',
      },
    });

    expect(
      container.querySelector('#msg-a-tool-call [data-testid="conversation-message-header"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('#msg-a-tool-call [data-testid="conversation-message-model-name"]')
        ?.textContent,
    ).toBe('gemini-3.7-flash');
  });

  it('does not repeat the identity header for two visible Conversation completions', () => {
    const userMessage = createUserMessage('u-two', 'look this up');
    const first: ChatMessageUi = {
      id: 'a-two-1',
      role: 'assistant',
      text: 'I will look that up.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      model: { protocol: 'openai-compatible', providerId: 'cpa', modelId: 'glm5.2' },
    };
    const second: ChatMessageUi = {
      id: 'a-two-2',
      role: 'assistant',
      text: 'Here is the result.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      model: { protocol: 'openai-compatible', providerId: 'cpa', modelId: 'glm5.2' },
    };
    renderConversation([userMessage, first, second]);

    expect(container.querySelector('#msg-a-two-1')).not.toBeNull();
    expect(container.querySelector('#msg-a-two-2')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="conversation-message-header"]')).toHaveLength(1);
    expect(container.querySelector('#msg-a-two-1 [data-testid="conversation-message-header"]')).not.toBeNull();
    expect(container.querySelector('#msg-a-two-2 [data-testid="conversation-message-header"]')).toBeNull();
    expect(container.querySelector('#msg-a-two-2')?.classList.contains('is-turn-continuation')).toBe(
      true,
    );
  });

  it('keeps Conversation copy/regenerate dock on the last completion only', () => {
    const userMessage = createUserMessage('u-loop', 'draw a pelican');
    const first: ChatMessageUi = {
      id: 'a-loop-1',
      role: 'assistant',
      text: '先读取 Artifact 规范，再做鹈鹕骑自行车的 SVG 动画。',
      thinking: 'load the spec',
      tools: [
        {
          toolCallId: 'tool-art-1',
          toolName: 'artifact_instructions',
          status: 'done',
          output: 'ok',
        },
      ],
      attachments: [],
      status: 'done',
      model: { protocol: 'openai-compatible', providerId: 'cpa', modelId: 'grok-4.6' },
    };
    const second: ChatMessageUi = {
      id: 'a-loop-2',
      role: 'assistant',
      text: '正在绘制一只大嘴鹈鹕骑车的循环动画。',
      thinking: 'draw the loop',
      tools: [
        {
          toolCallId: 'tool-art-2',
          toolName: 'artifact_instructions',
          status: 'done',
          output: 'ok',
        },
      ],
      attachments: [],
      status: 'done',
      model: { protocol: 'openai-compatible', providerId: 'cpa', modelId: 'grok-4.6' },
    };
    const finalReply: ChatMessageUi = {
      id: 'a-loop-3',
      role: 'assistant',
      text: '一只大嘴鹈鹕在海岸公路上骑复古自行车。',
      thinking: 'wrap up',
      tools: [],
      attachments: [],
      status: 'done',
      model: { protocol: 'openai-compatible', providerId: 'cpa', modelId: 'grok-4.6' },
    };
    renderConversation([userMessage, first, second, finalReply], {
      onBranchResend: vi.fn(),
      onForkFromMessage: vi.fn(),
    });

    expect(container.querySelector('#msg-a-loop-1 [data-testid="assistant-response-actions"]')).toBeNull();
    expect(container.querySelector('#msg-a-loop-2 [data-testid="assistant-response-actions"]')).toBeNull();
    expect(container.querySelector('#msg-a-loop-1 .markdown')).toBeNull();
    expect(container.querySelector('#msg-a-loop-2 .markdown')).toBeNull();
    expect(container.textContent).not.toContain('先读取 Artifact 规范');
    expect(container.textContent).not.toContain('正在绘制一只大嘴鹈鹕');
    expect(container.querySelector('#msg-a-loop-3 .markdown')?.textContent).toContain(
      '一只大嘴鹈鹕在海岸公路上骑复古自行车。',
    );
    expect(
      container.querySelector('#msg-a-loop-3 [data-testid="assistant-response-actions"]'),
    ).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="response-copy-btn"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="response-regenerate-btn"]')).toHaveLength(1);
    expect(container.querySelector('#msg-a-loop-3 [data-testid="response-copy-btn"]')).not.toBeNull();
    expect(container.querySelector('#msg-a-loop-3 [data-testid="response-regenerate-btn"]')).not.toBeNull();
  });

  it('still shows every Agent lifecycle row without Conversation headers', () => {
    const userMessage = createUserMessage('u-agent', 'inspect');
    const thinkingOnly: ChatMessageUi = {
      id: 'a-agent-think',
      role: 'assistant',
      text: '',
      thinking: 'plan the inspection',
      tools: [{ toolCallId: 'tool-1', toolName: 'bash', status: 'done', output: 'ok' }],
      attachments: [],
      status: 'done',
    };
    const finalReply: ChatMessageUi = {
      id: 'a-agent-final',
      role: 'assistant',
      text: 'Inspection done.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };
    renderConversation([userMessage, thinkingOnly, finalReply], {
      isConversationSession: false,
      workDetailsExpanded: 'always',
    });

    expect(container.querySelector('#msg-a-agent-think')).not.toBeNull();
    expect(container.querySelector('#msg-a-agent-final')).not.toBeNull();
    expect(container.querySelector('[data-testid="conversation-message-header"]')).toBeNull();
    expect(container.querySelector('[data-testid="turn-work-details"]')).not.toBeNull();
  });

  it('shows Conversation activity instead of AgentLocator while waiting', () => {
    renderConversation([createUserMessage('u-wait', 'hello')], {
      streaming: true,
      activeRunId: 'run-wait',
    });
    expect(container.querySelector('[data-testid="conversation-activity"]')?.textContent).toBe(
      'Thinking…',
    );
    expect(container.querySelector('[data-testid="run-activity-slot"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-locator"]')).toBeNull();
  });

  it('immediately renders assistant avatar, header, and thinking indicator upon user send while streaming', () => {
    renderConversation([createUserMessage('u-live', 'solve this problem')], {
      streaming: true,
      activeRunId: 'run-live',
      livePromptModel: {
        protocol: 'anthropic-compatible',
        providerId: 'anthropic',
        modelId: 'claude-3-7-sonnet',
      },
      locale: 'zh-CN',
    });

    expect(container.querySelector('[data-testid="conversation-message-header"]')).not.toBeNull();
    expect(container.querySelector('.conversation-message-provider-icon')).not.toBeNull();
    expect(container.querySelector('[data-testid="conversation-activity"]')?.textContent).toBe(
      '正在思考…',
    );
  });

  it('keeps Conversation activity while the opened reply has no content yet', () => {
    // Conversation replies have no in-bubble waiting line, so an empty
    // streaming bubble would otherwise render nothing but the model header.
    renderConversation(
      [
        createUserMessage('u-silent', 'hello'),
        {
          id: 'a-silent',
          role: 'assistant',
          text: '',
          thinking: '',
          tools: [],
          attachments: [],
          status: 'streaming',
          runId: 'run-silent',
        },
      ],
      { streaming: true, activeRunId: 'run-silent' },
    );

    expect(container.querySelector('[data-testid="conversation-activity"]')?.textContent).toBe(
      'Thinking…',
    );
  });

  it('shows flip cards on the visible Conversation reply after a cloze batch-create', () => {
    const output = JSON.stringify({
      created: [
        {
          id: 'card-f3dc5a95-msy8lzjt',
          model: 'cloze',
          deck: 'default',
          text: '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
          createdAt: '2026-08-18T05:43:48.281Z',
        },
      ],
      skipped: [],
    });
    renderConversation([
      createUserMessage('u-cloze', '给我做挖空闪卡'),
      {
        id: 'a-think',
        role: 'assistant',
        text: '',
        thinking: 'planning',
        tools: [],
        attachments: [],
        status: 'done',
      },
      {
        id: 'a-tool',
        role: 'assistant',
        text: '',
        thinking: 'creating cards',
        tools: [
          {
            toolCallId: 'tc-batch',
            toolName: 'piwin_toolbox',
            status: 'done',
            output,
            presentation: {
              kind: 'other',
              title: 'flashcard_batch_create',
              routedToolName: 'flashcard_batch_create',
              output: { text: output, truncated: false },
            },
          },
        ],
        attachments: [],
        status: 'done',
      },
      {
        id: 'a-summary',
        role: 'assistant',
        text: '已用一次 flashcard_batch_create 创建挖空闪卡',
        thinking: '',
        tools: [],
        attachments: [],
        status: 'done',
      },
    ]);

    const summary = container.querySelector('#msg-a-summary');
    expect(summary).not.toBeNull();
    expect(summary?.querySelector('[data-testid="conversation-extracted-flashcard"]')).not.toBeNull();
    expect(summary?.querySelector('[data-testid="chat-flashcard"]')).not.toBeNull();
    expect(summary?.textContent).toContain('[…]');
    expect(container.querySelector('#msg-a-tool [data-testid="conversation-extracted-flashcard"]')).toBeNull();
  });

  it('renders conversation assistant header with model snapshot and provider icon', () => {
    const userMessage = createUserMessage('u-1', 'hello');
    const assistant: ChatMessageUi = {
      id: 'a-1',
      role: 'assistant',
      text: 'Hello world!',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: '2026-08-18T14:15:00.000Z',
      model: {
        protocol: 'anthropic-compatible',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4',
      },
    };
    renderConversation([userMessage, assistant]);

    const header = container.querySelector('[data-testid="conversation-message-header"]');
    expect(header).not.toBeNull();
    expect(container.querySelector('[data-testid="conversation-message-model-name"]')?.textContent).toBe(
      'claude-sonnet-4',
    );
  });

  it('renders turn usage chip only on the latest completed assistant message', () => {
    const u1 = createUserMessage('u-1', 'first');
    const a1: ChatMessageUi = {
      id: 'a-1',
      role: 'assistant',
      text: 'first reply',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      model: { protocol: 'anthropic-compatible', providerId: 'anthropic', modelId: 'claude-sonnet-4' },
    };
    const u2 = createUserMessage('u-2', 'second');
    const a2: ChatMessageUi = {
      id: 'a-2',
      role: 'assistant',
      text: 'second reply',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      model: { protocol: 'anthropic-compatible', providerId: 'anthropic', modelId: 'claude-sonnet-4' },
    };

    renderConversation([u1, a1, u2, a2], {
      contextUsage: {
        sessionId: 'session-1',
        updatedAt: '2026-08-18T00:00:00.000Z',
        source: 'assistant-usage',
        promptTokens: 1200,
        completionTokens: 486,
        totalTokens: 1686,
        durationMs: 450,
      },
    });

    // Older assistant message has no usage chip
    const a1Row = container.querySelector('#msg-a-1');
    expect(a1Row?.querySelector('[data-testid="conversation-message-usage-chip"]')).toBeNull();

    // Latest assistant message has usage chip
    const a2Row = container.querySelector('#msg-a-2');
    const chip = a2Row?.querySelector('[data-testid="conversation-message-usage-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe('1.2K → 486');
  });

  it('places Conversation turn usage on the identity header of a multi-completion turn', () => {
    const userMessage = createUserMessage('u-usage-loop', 'fetch');
    const first: ChatMessageUi = {
      id: 'a-usage-1',
      role: 'assistant',
      text: 'Looking it up.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      model: { protocol: 'openai-compatible', providerId: 'cpa', modelId: 'glm5.2' },
    };
    const second: ChatMessageUi = {
      id: 'a-usage-2',
      role: 'assistant',
      text: 'Done.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      model: { protocol: 'openai-compatible', providerId: 'cpa', modelId: 'glm5.2' },
    };
    renderConversation([userMessage, first, second], {
      contextUsage: {
        sessionId: 'session-1',
        updatedAt: '2026-08-20T00:00:00.000Z',
        source: 'assistant-usage',
        promptTokens: 1200,
        completionTokens: 486,
        totalTokens: 1686,
      },
    });

    expect(container.querySelector('#msg-a-usage-1 [data-testid="conversation-message-usage-chip"]')?.textContent).toBe(
      '1.2K → 486',
    );
    expect(container.querySelector('#msg-a-usage-2 [data-testid="conversation-message-usage-chip"]')).toBeNull();
  });

  it('renders user message with conversation bubble class and avatar monogram in Conversation mode', () => {
    const userMessage = createUserMessage('u-conv', 'user prompt');
    renderConversation([userMessage], { locale: 'zh-CN' });

    const userBubble = container.querySelector('#msg-u-conv');
    expect(userBubble?.classList.contains('is-conversation-bubble')).toBe(true);

    const avatar = userBubble?.querySelector('[data-testid="user-message-avatar"]');
    expect(avatar).not.toBeNull();
    expect(avatar?.textContent).toBe('我');
  });

  it('provides regenerate button on latest assistant response that branches the preceding user message', () => {
    const onBranchResend = vi.fn();
    const u1 = createUserMessage('u-1', 'hello to retry');
    const a1: ChatMessageUi = {
      id: 'a-1',
      role: 'assistant',
      text: 'answer to regenerate',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };

    renderConversation([u1, a1], { onBranchResend });

    const regenerateBtn = container.querySelector('[data-testid="response-regenerate-btn"]') as HTMLButtonElement | null;
    expect(regenerateBtn).not.toBeNull();

    act(() => {
      regenerateBtn?.click();
    });

    expect(onBranchResend).toHaveBeenCalledWith('u-1', 'hello to retry');
  });

  it('does NOT render conversation header in project mode and keeps TurnWorkDetails', () => {
    const userMessage = createUserMessage('u-proj', 'project work');
    const assistant: ChatMessageUi = {
      id: 'a-proj',
      role: 'assistant',
      text: 'project answer',
      thinking: 'some reasoning',
      tools: [],
      attachments: [],
      status: 'done',
    };

    renderConversation([userMessage, assistant], {
      isConversationSession: false,
    });

    expect(container.querySelector('[data-testid="conversation-message-header"]')).toBeNull();
    expect(container.querySelector('[data-testid="turn-work-details"]')).not.toBeNull();
  });
});
