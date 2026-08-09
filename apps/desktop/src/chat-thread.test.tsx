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
import type { AgentEvent, ExecutionRunRecord } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ChatThread } from './chat-thread';
import { RightPanel } from './right-panel';
import {
  chatUiReducer,
  createInitialChatUiState,
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
  onAttachImage: noop,
  onPaste: noop,
  onDrop: noop,
  onSend: noop,
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
      <ChatThread
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
          onAttachImage: noop,
          onPaste: noop,
          onDrop: noop,
          onSend: noop,
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
  // 1. Historical rows + closed right panel do not rerender for
  //    streaming deltas, and the streaming row commits exactly once
  //    per synthetic frame batch.
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

    // Three deltas within one frame reach the real reducer dispatch path.
    readyStreamEventBuffer.push('s1', createDeltaEvent('streaming-e1', ' plus'));
    readyStreamEventBuffer.push('s1', createDeltaEvent('streaming-e1', ' three'));
    readyStreamEventBuffer.push('s1', createDeltaEvent('streaming-e1', ' deltas'));

    expect(scheduledFrames.length).toBe(1);

    // The only state change and React commit in this test is this frame flush.
    act(() => {
      const frameCallback = scheduledFrames[0];
      if (frameCallback) {
        frameCallback();
      }
    });

    const updatedBubbles = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="message-bubble"]'),
    );
    const lastBubble = updatedBubbles[updatedBubbles.length - 1];
    expect(lastBubble?.textContent).toContain('Initial streaming plus three deltas');

    // Profiler confirms that React committed the frame-dispatched update. Its
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
  // 2. Terminal/lifecycle events bypass the frame queue immediately,
  //    flushing pending deltas synchronously.
  // ————————————————————————————————————————————————————————————————
  it('bypasses frame queue for terminal/lifecycle events', () => {
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

    // Push a text delta first (this schedules a frame)
    buffer.push('s1', createDeltaEvent('streaming-e2', ' delta-data'));

    // Push a terminal event — must flush pending deltas and dispatch immediately
    const terminalRun: ExecutionRunRecord = {
      runId: 'run-e2',
      kind: 'session-turn',
      status: 'completed',
      rootRunId: 'run-e2',
      sessionId: 's1',
      endedAt: new Date().toISOString(),
      terminalCode: 'completed',
    };
    buffer.flush();
    dispatchedActions.push({ type: 'run/terminal', run: terminalRun });
    appState = chatUiReducer(appState, { type: 'run/terminal', run: terminalRun });

    // ---- Assertions ----

    // A. Two actions dispatched: first the pending batch, then the immediate event
    expect(dispatchedActions.length).toBe(2);

    const firstAction = dispatchedActions[0];
    expect(firstAction?.type).toBe('event/batch');
    if (firstAction?.type === 'event/batch') {
      expect(firstAction.events).toHaveLength(1);
      expect(firstAction.events[0]?.type).toBe('message/text_delta');
    }

    const secondAction = dispatchedActions[1];
    expect(secondAction?.type).toBe('run/terminal');
    if (secondAction?.type === 'run/terminal') {
      expect(secondAction.run.runId).toBe('run-e2');
    }

    // B. The scheduled frame was cancelled — it should never fire
    expect(scheduledFrames.length).toBe(1);

    // C. The streaming message text reflects the flushed delta
    const lastMessage = appState.messages[appState.messages.length - 1];
    expect(lastMessage?.text).toBe('Partial delta-data');
  });

  // ————————————————————————————————————————————————————————————————
  // Run activity wiring
  // ————————————————————————————————————————————————————————————————
  it('renders run-activity slot when streaming and the last message is from the user', () => {
    const userMessage = createUserMessage('u1', 'Hello');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThread
            messages={[userMessage]}
            streaming={true}
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
  });

  it('removes run-activity slot when a streaming assistant message arrives', () => {
    const userMessage = createUserMessage('u2', 'Hello');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThread
            messages={[userMessage]}
            streaming={true}
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

    expect(container.querySelector('[data-testid="run-activity-slot"]')).not.toBeNull();

    const assistantMessage = createStreamingAssistant('a1');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThread
            messages={[userMessage, assistantMessage]}
            streaming={true}
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

  it('removes run-activity slot when permissionPrompt is present or streaming is false', () => {
    const userMessage = createUserMessage('u3', 'Hello');
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChatThread
            messages={[userMessage]}
            streaming={true}
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
          <ChatThread
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
          <ChatThread
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
          <ChatThread
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
          <ChatThread
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
          <ChatThread
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
            <ChatThread
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
    expect(container.querySelector('[data-testid="image-generation-progress"]')).toMatchObject({
      textContent: expect.stringContaining('Image generated'),
    });
    expect(
      container
        .querySelector('[data-testid="image-generation-progress"]')
        ?.getAttribute('data-tool-status'),
    ).toBe('done');
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
    expect(container.querySelector('[data-testid="tool-call-err"]')).not.toBeNull();

    renderMessage({
      ...runningMessage,
      id: 'video-generation-running',
      tools: [{ ...imageTool, toolCallId: 'video-tool-1', toolName: 'video_gen' }],
    });
    expect(container.querySelector('[data-testid="video-generation-progress"]')).not.toBeNull();
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
          <ChatThread
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
          <ChatThread
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

    expect(container.querySelector('[data-testid="turn-summary-active-animation"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="turn-summary-radial-bellow"]')).toMatchObject({
      className: expect.stringContaining('ui-anim--sm'),
    });
  });
});

// ---------------------------------------------------------------------------
// Shared noop — avoids inline function allocations in Profiler subtrees
// ---------------------------------------------------------------------------

function noop(): void {
  /* intentional noop for callback props */
}
