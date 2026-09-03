// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptContextRef } from '@piwin/contracts';
import { formatSkillPrompt } from '@piwin/contracts';
import type { ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { useComposerMedia } from './use-composer-media';
import {
  createInitialTestChatUiState,
  pasteImage,
  type ComposerMediaResult,
} from './composer-media-test-harness';

// Image encode/decode paths are DOM-canvas based; keep the deferred-save tests
// deterministic by stubbing only the binary preparation helpers.
// happy-dom cannot decode PNG bytes; keep lightbox object-URL behavior and
// skip the async limited-bitmap fill so existing paste tests stay quiet.
vi.mock('../media-preview-bitmap.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../media-preview-bitmap.js')>();
  return {
    ...actual,
    beginComposerImagePreview: (file: File) => ({
      lightboxUrl: URL.createObjectURL(file),
    }),
  };
});

vi.mock('../media-utils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../media-utils.js')>();
  return {
    ...actual,
    prepareComposerAttachmentForSave: vi.fn(
      async (file: File, mimeType: string, contentKind: string) => ({
        blob: file,
        mimeType,
        byteSize: file.size,
        compressed: false,
        contentKind,
      }),
    ),
    fileToBase64: vi.fn(async () => 'iVBORw0KGgo='),
  };
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('useComposerMedia session transitions', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('uses the clicked project scope for the first Host session request', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn().mockResolvedValue({
        type: 'response',
        command: 'session/prompt',
        success: true,
        data: { runId: 'run-1', acceptedAt: '2026-08-12T00:00:00.000Z' },
      }),
    } as unknown as HostClient;
    const ensureSession = vi.fn().mockResolvedValue('project-session-1');
    let captured: ComposerMediaResult | undefined;

    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient,
        state: props.state,
        dispatch: vi.fn(),
        agentMode: 'agent',
        ensureSession,
      });
      return null;
    }

    const projectPath = '/Users/test/project-a';
    const state = {
      ...createInitialTestChatUiState(),
      activeSessionId: null,
      projectPath,
      projectTrusted: true,
    };
    act(() => root?.render(<Harness state={state} />));
    act(() => {
      captured?.startNewDraft({ kind: 'project', projectPath });
      captured?.setComposer('start in the clicked project');
    });
    await act(async () => {
      await captured?.handleSend();
    });

    expect(ensureSession).toHaveBeenCalledWith({
      scope: { kind: 'project', projectPath },
      projectPath,
      alreadyTrusted: true,
      sessionName: 'start in the clicked project',
    });
  });

  it('send snapshot is not changed by late chip edits while session creation waits', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn().mockResolvedValue({
        type: 'response',
        command: 'session/prompt',
        success: true,
        data: { runId: 'run-1', acceptedAt: '2026-08-12T00:00:00.000Z' },
      }),
    } as unknown as HostClient;
    let releaseEnsure: ((id: string) => void) | undefined;
    const ensureSession = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          releaseEnsure = resolve;
        }),
    );
    let captured: ComposerMediaResult | undefined;
    const pendingRefs: PromptContextRef[] = [
      { kind: 'error', title: 'Original', detail: 'original detail', label: 'orig' },
    ];
    const pendingTokens = () => ({
      items: pendingRefs.map((ref, index) => ({ token: `token-${index}`, ref })),
    });

    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient,
        state: props.state,
        dispatch: vi.fn(),
        agentMode: 'agent',
        ensureSession,
        getPendingContextRefs: () => pendingRefs,
        getPendingContextRefTokens: () => pendingTokens(),
        clearPendingContextRefs: () => {
          pendingRefs.splice(0, pendingRefs.length);
        },
      });
      return null;
    }

    const state = {
      ...createInitialTestChatUiState(),
      activeSessionId: null,
      projectPath: '/Users/test/project-b',
      projectTrusted: true,
    };
    act(() => root?.render(<Harness state={state} />));
    act(() => {
      captured?.startNewDraft({ kind: 'project', projectPath: '/Users/test/project-b' });
      captured?.setComposer('send with refs');
    });

    let sendPromise: Promise<void> | undefined;
    act(() => {
      sendPromise = captured?.handleSend();
    });
    // While ensureSession is pending, mutate the visible chips.
    pendingRefs.splice(0, pendingRefs.length, {
      kind: 'error',
      title: 'Changed',
      detail: 'changed detail',
      label: 'changed',
    });
    expect(releaseEnsure).toBeDefined();
    await act(async () => {
      releaseEnsure?.('project-session-b');
      await sendPromise;
    });

    const requestMock = vi.mocked(hostClient.request);
    const promptCalls = requestMock.mock.calls.filter((call) => call[0]?.type === 'session/prompt');
    expect(requestMock).toHaveBeenCalledOnce();
    expect(promptCalls).toHaveLength(1);
    const input = (
      promptCalls[0]?.[0] as Extract<Parameters<typeof requestMock>[0], { type: 'session/prompt' }>
    )?.input;
    expect(input?.contextRefs).toEqual([expect.objectContaining({ title: 'Original' })]);
    expect(input?.contextRefs).not.toEqual([expect.objectContaining({ title: 'Changed' })]);
  });

  it('paints the same context refs on a remote transport that actually reach the Host', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn().mockResolvedValue({
        type: 'response',
        command: 'session/prompt',
        success: true,
        data: { runId: 'run-1', acceptedAt: '2026-08-12T00:00:00.000Z' },
      }),
      getTransport: () => 'remote',
      isReady: () => true,
    } as unknown as HostClient;
    const dispatch = vi.fn();
    // A raw local file path is not a Host-safe remote ref (only opaque
    // `project-<hex>` ids are); it must be flattened out of contextRefs on a
    // remote transport, same as it would be before persisting.
    const pendingRefs: PromptContextRef[] = [
      { kind: 'selection', snapshotText: 'safe body', label: 'safe body' },
      {
        kind: 'file',
        projectPath: '/Users/test/project-a',
        relativePath: 'src/index.ts',
        label: 'index.ts',
      },
    ];
    let captured: ComposerMediaResult | undefined;

    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient,
        state: props.state,
        dispatch,
        agentMode: 'agent',
        getPendingContextRefs: () => pendingRefs,
      });
      return null;
    }

    const state = { ...createInitialTestChatUiState(), activeSessionId: 'session-1' };
    act(() => root?.render(<Harness state={state} />));
    act(() => {
      captured?.setComposer('quoting a local file');
    });
    await act(async () => {
      await captured?.handleSend();
    });

    const sendCall = dispatch.mock.calls.find((call) => call[0]?.type === 'user/send')?.[0];
    const paintedRefs = sendCall?.contextRefs as PromptContextRef[] | undefined;
    const paintedText = sendCall?.text as string | undefined;
    const requestMock = vi.mocked(hostClient.request);
    const promptCall = requestMock.mock.calls.find((call) => call[0]?.type === 'session/prompt');
    const promptInput = (
      promptCall?.[0] as Extract<Parameters<typeof requestMock>[0], { type: 'session/prompt' }>
    )?.input;

    // The optimistic bubble must show exactly what was sent/persisted, never
    // a superset that then vanishes once this message round-trips through
    // the Host and gets re-hydrated from the stored transcript.
    expect(paintedRefs).toEqual(promptInput?.contextRefs);
    expect(paintedRefs?.some((ref) => ref.kind === 'file')).toBe(false);
    expect(paintedRefs?.some((ref) => ref.kind === 'selection')).toBe(true);
    // The dropped file ref's label gets appended as plain text (same as what
    // the Host actually receives), so the bubble never silently loses it.
    expect(paintedText).toBe(promptInput?.text);
    expect(paintedText).toBe('quoting a local file\n\nindex.ts');
  });

  it('retries an intervention ACK timeout with the same stable identities', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const commands: Array<{
      type: string;
      interventionId?: string;
      userMessageId?: string;
      sessionId?: string;
      runId?: string;
      input?: { text: string };
    }> = [];
    const hostClient = {
      request: vi.fn(async (command: (typeof commands)[number]) => {
        commands.push(command);
        if (commands.length === 1) {
          return {
            type: 'response' as const,
            command: command.type,
            success: false as const,
            error: 'host request timed out after 5000ms',
          };
        }
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: {
            intervention: {
              interventionId: command.interventionId ?? 'missing-intervention',
              revision: 1,
              sessionId: command.sessionId ?? 'missing-session',
              runId: command.runId ?? 'missing-run',
              runtimeGenerationId: 'generation-1',
              sequence: 1,
              userMessageId: command.userMessageId ?? 'missing-message',
              status: 'pending' as const,
              input: command.input ?? { text: '' },
              submittedAt: '2026-08-15T00:00:00.000Z',
              updatedAt: '2026-08-15T00:00:00.000Z',
            },
          },
        };
      }),
    } as unknown as HostClient;
    const dispatch = vi.fn();
    let captured: ComposerMediaResult | undefined;

    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'session-1',
          activeRunId: 'run-1',
          runPhase: 'streaming',
          streaming: true,
        },
        dispatch,
        agentMode: 'agent',
      });
      return null;
    }

    act(() => root?.render(<Harness />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };
    act(() => latest().setComposer('Use the smaller fix'));
    await act(async () => {
      await latest().handleSteer();
    });

    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({ type: 'run/intervention-submit', runId: 'run-1' });
    expect(commands[1]?.interventionId).toBe(commands[0]?.interventionId);
    expect(commands[1]?.userMessageId).toBe(commands[0]?.userMessageId);
    expect(commands.every((command) => command.type !== 'session/queued-turn-submit')).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run/intervention-updated' }),
    );
    expect(latest().composer).toBe('');
  });

  it('freezes slash-mode prompt preparation when Send becomes a queued turn', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const dispatch = vi.fn();
    const hostClient = {
      request: vi.fn(async (command: { type: string; input?: Record<string, unknown> }) => {
        if (command.type === 'session/queued-turn-list') {
          return {
            type: 'response' as const,
            command: command.type,
            success: true as const,
            data: { queueRevision: 1, queuedTurns: [] },
          };
        }
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: {
            queuedTurn: {
              queuedTurnId: 'queued-1',
              revision: 1,
              sessionId: 'session-1',
              sequence: 1,
              userMessageId: 'user-1',
              mode: 'next' as const,
              status: 'pending' as const,
              input: command.input ?? { text: '' },
              submittedAt: '2026-08-15T00:00:00.000Z',
              updatedAt: '2026-08-15T00:00:00.000Z',
            },
          },
        };
      }),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;
    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'session-1',
          activeRunId: 'run-1',
          runPhase: 'streaming',
          streaming: true,
        },
        dispatch,
        agentMode: 'agent',
      });
      return null;
    }
    act(() => root?.render(<Harness />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };
    act(() => latest().setComposer('/goal focus on the failing test'));
    await act(async () => {
      await latest().handleSend();
    });
    const command = vi.mocked(hostClient.request).mock.calls[0]?.[0] as {
      type: string;
      input: { text: string; agentMode?: string };
    };
    expect(command.type).toBe('session/queued-turn-submit');
    expect(command.input).toMatchObject({ text: 'focus on the failing test', agentMode: 'goal' });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'user/send' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'session/queued-turns-hydrate',
      sessionId: 'session-1',
      queueRevision: 1,
      queuedTurns: [],
    });
  });

  it('does not queue /compact as a follow-up while streaming', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onCompact = vi.fn(async () => true);
    const hostClient = {
      request: vi.fn(async () => ({
        type: 'response' as const,
        command: 'session/queued-turn-submit',
        success: true as const,
        data: {},
      })),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;
    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'session-1',
          activeRunId: 'run-1',
          runPhase: 'streaming',
          streaming: true,
        },
        dispatch: vi.fn(),
        agentMode: 'agent',
        onCompact,
      });
      return null;
    }
    act(() => root?.render(<Harness />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };
    act(() => latest().setComposer('/compact keep the plan'));
    act(() => {
      latest().handleFollowUp();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onCompact).toHaveBeenCalledWith('keep the plan');
    expect(vi.mocked(hostClient.request)).not.toHaveBeenCalled();
    expect(latest().composer).toBe('');
  });

  it('intercepts /compact on Send even when foreground admission is not ready', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onCompact = vi.fn(async () => true);
    const hostClient = {
      request: vi.fn(),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;
    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'session-1',
          foregroundAdmission: 'unknown',
        },
        dispatch: vi.fn(),
        agentMode: 'agent',
        onCompact,
      });
      return null;
    }
    act(() => root?.render(<Harness />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };
    act(() => latest().setComposer('/compact'));
    await act(async () => {
      await latest().handleSend();
    });
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(vi.mocked(hostClient.request)).not.toHaveBeenCalled();
    expect(latest().composer).toBe('');
  });

  it('runs /compact even when leftover attachment chips are present', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onCompact = vi.fn(async () => true);
    const hostClient = {
      request: vi.fn(),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;
    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'session-1',
        },
        dispatch: vi.fn(),
        agentMode: 'agent',
        onCompact,
      });
      return null;
    }
    act(() => root?.render(<Harness />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };
    pasteImage(latest);
    act(() => latest().setComposer('/compact'));
    await act(async () => {
      await latest().handleSend();
    });
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(vi.mocked(hostClient.request)).not.toHaveBeenCalled();
    expect(latest().composer).toBe('');
    expect(latest().pendingAttachments).toHaveLength(0);
  });

  it('runs /compact instead of saving a queued-turn edit', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onCompact = vi.fn(async () => true);
    const hostClient = {
      request: vi.fn(),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;
    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'session-1',
          activeRunId: 'run-1',
          runPhase: 'streaming',
          streaming: true,
          queuedTurnsBySession: {
            'session-1': [
              {
                queuedTurnId: 'queued-1',
                revision: 1,
                sessionId: 'session-1',
                sequence: 1,
                userMessageId: 'user-queued-1',
                mode: 'next',
                status: 'pending',
                input: { text: 'follow up later' },
                submittedAt: '2026-08-15T00:00:00.000Z',
                updatedAt: '2026-08-15T00:00:00.000Z',
              },
            ],
          },
        },
        dispatch: vi.fn(),
        agentMode: 'agent',
        onCompact,
      });
      return null;
    }
    act(() => root?.render(<Harness />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };
    act(() => {
      latest().handleSteerQueueEdit('queued-1');
    });
    act(() => latest().setComposer('/compact keep the plan'));
    await act(async () => {
      await latest().handleSend();
    });
    expect(onCompact).toHaveBeenCalledWith('keep the plan');
    expect(vi.mocked(hostClient.request)).not.toHaveBeenCalled();
  });

  it('converts a queued message into a Run intervention on send-now', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const dispatch = vi.fn();
    const hostClient = {
      request: vi.fn(async () => ({
        type: 'response' as const,
        command: 'run/intervention-submit',
        success: true as const,
        data: {
          intervention: {
            interventionId: 'intervention-1',
            revision: 1,
            sessionId: 'session-1',
            runId: 'run-1',
            runtimeGenerationId: 'generation-1',
            sequence: 1,
            userMessageId: 'user-queued-1',
            status: 'pending' as const,
            input: { text: 'Adjust the model mapping' },
            submittedAt: '2026-08-15T00:00:00.000Z',
            updatedAt: '2026-08-15T00:00:00.000Z',
          },
          queuedTurn: {
            queuedTurnId: 'queued-1',
            revision: 4,
            sessionId: 'session-1',
            sequence: 1,
            userMessageId: 'user-queued-1',
            mode: 'next' as const,
            status: 'cancelled' as const,
            input: { text: 'Adjust the model mapping' },
            submittedAt: '2026-08-15T00:00:00.000Z',
            updatedAt: '2026-08-15T00:00:00.000Z',
            terminalReason: 'converted-to-intervention' as const,
          },
        },
      })),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;
    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'session-1',
          activeRunId: 'run-1',
          runPhase: 'streaming',
          streaming: true,
          queuedTurnsBySession: {
            'session-1': [
              {
                queuedTurnId: 'queued-1',
                revision: 3,
                sessionId: 'session-1',
                sequence: 1,
                userMessageId: 'user-queued-1',
                mode: 'next',
                status: 'pending',
                input: { text: 'Adjust the model mapping' },
                submittedAt: '2026-08-15T00:00:00.000Z',
                updatedAt: '2026-08-15T00:00:00.000Z',
              },
            ],
          },
        },
        dispatch,
        agentMode: 'agent',
      });
      return null;
    }
    act(() => root?.render(<Harness />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };

    await act(async () => {
      await latest().handleSteerQueueSendNow('queued-1');
    });

    expect(hostClient.request).toHaveBeenCalledTimes(1);
    const command = vi.mocked(hostClient.request).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(command).toMatchObject({
      type: 'run/intervention-submit',
      sessionId: 'session-1',
      runId: 'run-1',
      userMessageId: 'user-queued-1',
      input: { text: 'Adjust the model mapping' },
      adoptQueuedTurn: { queuedTurnId: 'queued-1', expectedRevision: 3 },
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session/queued-turn-updated',
        queuedTurn: expect.objectContaining({
          queuedTurnId: 'queued-1',
          status: 'cancelled',
          terminalReason: 'converted-to-intervention',
        }),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run/intervention-updated',
        intervention: expect.objectContaining({ interventionId: 'intervention-1' }),
      }),
    );
  });

  it('does not convert a queued /compact into a Run intervention', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onCompact = vi.fn(async () => true);
    const hostClient = {
      request: vi.fn(),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;
    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'session-1',
          activeRunId: 'run-1',
          runPhase: 'streaming',
          streaming: true,
          queuedTurnsBySession: {
            'session-1': [
              {
                queuedTurnId: 'queued-compact',
                revision: 1,
                sessionId: 'session-1',
                sequence: 1,
                userMessageId: 'user-compact-1',
                mode: 'next',
                status: 'pending',
                input: { text: '/compact keep the plan' },
                submittedAt: '2026-08-15T00:00:00.000Z',
                updatedAt: '2026-08-15T00:00:00.000Z',
              },
            ],
          },
        },
        dispatch: vi.fn(),
        agentMode: 'agent',
        onCompact,
      });
      return null;
    }
    act(() => root?.render(<Harness />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };
    await act(async () => {
      await latest().handleSteerQueueSendNow('queued-compact');
    });
    expect(onCompact).toHaveBeenCalledWith('keep the plan');
    expect(vi.mocked(hostClient.request)).not.toHaveBeenCalled();
  });
});

describe('useComposerMedia Conversation send path', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
  });

  function readPromptInput(hostClient: HostClient): {
    text?: string;
    agentMode?: string;
    orchestrationSchemeId?: string;
    skillId?: string;
  } {
    const requestMock = vi.mocked(hostClient.request);
    const promptCall = requestMock.mock.calls.find((call) => call[0]?.type === 'session/prompt');
    const command = promptCall?.[0] as
      { type: 'session/prompt'; input?: Record<string, unknown> } | undefined;
    return (command?.input ?? {}) as {
      text?: string;
      agentMode?: string;
      orchestrationSchemeId?: string;
      skillId?: string;
    };
  }

  it('omits Agent mode, orchestration, and skill from Conversation prompts', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn().mockResolvedValue({
        type: 'response',
        command: 'session/prompt',
        success: true,
        data: { runId: 'run-1', acceptedAt: '2026-08-16T00:00:00.000Z' },
      }),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;

    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'conversation-1',
          activeScope: { kind: 'general' },
        },
        dispatch: vi.fn(),
        agentMode: 'agent',
        orchestrationSchemeId: 'ultra-code',
        conversationChat: true,
      });
      return null;
    }

    act(() => root?.render(<Harness />));
    act(() => {
      captured?.setComposer('hello conversation');
    });
    await act(async () => {
      await captured?.handleSend();
    });

    const input = readPromptInput(hostClient);
    expect(input.text).toBe('hello conversation');
    expect(input.agentMode).toBeUndefined();
    expect(input.orchestrationSchemeId).toBeUndefined();
    expect(input.skillId).toBeUndefined();
  });

  it('sends Goal from Conversation slash `/goal`', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const onAgentModeChange = vi.fn();
    const hostClient = {
      request: vi.fn().mockResolvedValue({
        type: 'response',
        command: 'session/prompt',
        success: true,
        data: { runId: 'run-1', acceptedAt: '2026-08-16T00:00:00.000Z' },
      }),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;

    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'conversation-1',
          activeScope: { kind: 'general' },
        },
        dispatch: vi.fn(),
        agentMode: 'agent',
        conversationChat: true,
        onAgentModeChange,
      });
      return null;
    }

    act(() => root?.render(<Harness />));
    act(() => {
      captured?.setComposer('/goal ship the login flow');
    });
    await act(async () => {
      await captured?.handleSend();
    });

    expect(onAgentModeChange).toHaveBeenCalledWith('goal');
    const input = readPromptInput(hostClient);
    expect(input.text).toBe('ship the login flow');
    expect(input.agentMode).toBe('goal');
  });

  it('sends an explicit skill from Conversation slash `/create-skill`', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn().mockResolvedValue({
        type: 'response',
        command: 'session/prompt',
        success: true,
        data: { runId: 'run-1', acceptedAt: '2026-08-16T00:00:00.000Z' },
      }),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;

    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'conversation-1',
          activeScope: { kind: 'general' },
        },
        dispatch: vi.fn(),
        agentMode: 'agent',
        conversationChat: true,
        menuSkills: [{ id: 'create-skill', name: 'create-skill', enabled: true }],
      });
      return null;
    }

    act(() => root?.render(<Harness />));
    act(() => {
      captured?.setComposer('/create-skill write a search skill');
    });
    await act(async () => {
      await captured?.handleSend();
    });

    const input = readPromptInput(hostClient);
    expect(input.text).toBe(
      formatSkillPrompt('create-skill', 'create-skill', 'write a search skill'),
    );
    expect(input.skillId).toBeUndefined();
    expect(input.agentMode).toBeUndefined();
  });

  it('still sends Agent fields for Project sessions', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn().mockResolvedValue({
        type: 'response',
        command: 'session/prompt',
        success: true,
        data: { runId: 'run-1', acceptedAt: '2026-08-16T00:00:00.000Z' },
      }),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;

    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: {
          ...createInitialTestChatUiState(),
          activeSessionId: 'project-1',
          projectPath: '/tmp/piwin-project',
          projectTrusted: true,
          activeScope: { kind: 'project', projectPath: '/tmp/piwin-project' },
        },
        dispatch: vi.fn(),
        agentMode: 'goal',
        orchestrationSchemeId: 'ultra-code',
      });
      return null;
    }

    act(() => root?.render(<Harness />));
    act(() => {
      captured?.setComposer('hello project');
    });
    await act(async () => {
      await captured?.handleSend();
    });

    const input = readPromptInput(hostClient);
    expect(input.text).toBe('hello project');
    expect(input.agentMode).toBe('goal');
    expect(input.orchestrationSchemeId).toBe('ultra-code');
  });

  it('puts New Agent text back in the composer when session/prompt never ACKs', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn().mockResolvedValue({
        type: 'response',
        command: 'session/prompt',
        success: false,
        error: 'Host request timed out: session/prompt',
      }),
    } as unknown as HostClient;
    const ensureSession = vi.fn().mockResolvedValue('session-created-on-send');
    const dispatch = vi.fn();
    let captured: ComposerMediaResult | undefined;

    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient,
        state: props.state,
        dispatch,
        agentMode: 'agent',
        ensureSession,
      });
      return null;
    }

    const draftState = {
      ...createInitialTestChatUiState(),
      activeSessionId: null,
    };
    act(() => root?.render(<Harness state={draftState} />));
    act(() => {
      captured?.setComposer('keep this unsent prompt');
    });
    await act(async () => {
      await captured?.handleSend();
    });

    expect(captured?.composer).toBe('keep this unsent prompt');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'user/send-rollback' }));
  });
});
