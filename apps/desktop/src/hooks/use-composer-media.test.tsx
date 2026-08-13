// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptContextRef } from '@piwin/contracts';
import { createInitialChatUiState, type ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { useComposerMedia } from './use-composer-media';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Image encode/decode paths are DOM-canvas based; keep the deferred-save tests
// deterministic by stubbing only the binary preparation helpers.
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

type ComposerMediaResult = ReturnType<typeof useComposerMedia>;

function createPngFile(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'screenshot.png', {
    type: 'image/png',
  });
}

function pasteImage(latest: () => ComposerMediaResult): File {
  const image = createPngFile();
  const preventDefault = vi.fn();
  act(() =>
    latest().handleComposerPaste({
      clipboardData: {
        items: [{ kind: 'file', getAsFile: () => image }],
      },
      preventDefault,
    } as unknown as Parameters<ComposerMediaResult['handleComposerPaste']>[0]),
  );
  expect(preventDefault).toHaveBeenCalledOnce();
  return image;
}

function createSavedMediaResponse(commandType: string) {
  if (commandType === 'media/save') {
    return {
      type: 'response' as const,
      command: commandType,
      success: true,
      data: {
        asset: {
          id: 'asset-1',
          sessionId: 'session-1',
          absolutePath: '/Users/test/.piwin/media/session-1/screenshot.png',
          mimeType: 'image/png',
          name: 'screenshot.png',
          contentKind: 'image',
          byteSize: 4,
          createdAt: '2026-08-12T00:00:00.000Z',
        },
      },
    };
  }
  if (commandType === 'session/prompt') {
    return {
      type: 'response' as const,
      command: commandType,
      success: true,
      data: { runId: 'run-1', acceptedAt: '2026-08-12T00:00:00.000Z' },
    };
  }
  return { type: 'response' as const, command: commandType, success: true, data: {} };
}

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

  it('keeps text and attachments scoped to their existing session', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn(),
    } as unknown as HostClient;
    const dispatch = vi.fn();
    let captured: ComposerMediaResult | undefined;

    const latest = (): ComposerMediaResult => {
      if (captured === undefined) {
        throw new Error('composer media hook was not rendered');
      }
      return captured;
    };

    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient,
        state: props.state,
        dispatch,
        agentMode: 'agent',
      });
      return null;
    }

    const sessionAState = {
      ...createInitialChatUiState(),
      activeSessionId: 'session-a',
    };
    act(() => root?.render(<Harness state={sessionAState} />));
    act(() => {
      latest().setComposer('unsent text for session A');
      latest().addWebElement({
        url: 'https://example.com',
        selector: '#target',
        text: 'target',
        boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      });
    });
    expect(latest().pendingAttachments).toHaveLength(1);

    const sessionBState = {
      ...sessionAState,
      activeSessionId: 'session-b',
    };
    act(() => root?.render(<Harness state={sessionBState} />));

    expect(latest().composer).toBe('');
    expect(latest().pendingAttachments).toEqual([]);
    expect(latest().draftSessions).toEqual([]);

    act(() => latest().setComposer('unsent text for session B'));
    act(() => root?.render(<Harness state={sessionAState} />));

    expect(latest().composer).toBe('unsent text for session A');
    expect(latest().pendingAttachments).toHaveLength(1);
    expect(latest().draftSessions).toEqual([]);

    act(() => root?.render(<Harness state={sessionBState} />));

    expect(latest().composer).toBe('unsent text for session B');
    expect(latest().pendingAttachments).toEqual([]);
    expect(latest().draftSessions).toEqual([]);
  });

  it('uses a phantom sidebar row only for an unsent New Agent draft', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn(),
    } as unknown as HostClient;
    const dispatch = vi.fn();
    let captured: ComposerMediaResult | undefined;

    const latest = (): ComposerMediaResult => {
      if (captured === undefined) {
        throw new Error('composer media hook was not rendered');
      }
      return captured;
    };

    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient,
        state: props.state,
        dispatch,
        agentMode: 'agent',
      });
      return null;
    }

    const sessionState = {
      ...createInitialChatUiState(),
      activeSessionId: 'existing-session',
    };
    const newAgentState = {
      ...sessionState,
      activeSessionId: null,
    };

    act(() => root?.render(<Harness state={sessionState} />));
    act(() => latest().setComposer('existing session draft'));
    act(() => latest().startNewDraft());
    act(() => root?.render(<Harness state={newAgentState} />));

    expect(latest().composer).toBe('');
    expect(latest().draftSessions).toEqual([]);

    act(() => latest().setComposer('brand new agent draft'));
    act(() => root?.render(<Harness state={sessionState} />));

    expect(latest().composer).toBe('existing session draft');
    expect(latest().draftSessions).toHaveLength(1);
    expect(latest().draftSessions[0]?.text).toBe('brand new agent draft');

    // Project/scope navigation also passes through activeSessionId=null. It
    // must not revive the parked New Agent draft unless that row was clicked.
    act(() => root?.render(<Harness state={newAgentState} />));
    expect(latest().composer).toBe('');
    expect(latest().draftSessions).toHaveLength(1);

    // App may await a project switch before invoking a callback captured from
    // the previous render. It must read the current session target from a ref,
    // not overwrite the old session snapshot with the interim blank composer.
    act(() => root?.render(<Harness state={sessionState} />));
    const resumeAfterScopeChange = latest().resumeDraft;
    const draftId = latest().draftSessions[0]?.id;
    expect(draftId).toBeDefined();
    act(() => root?.render(<Harness state={newAgentState} />));
    act(() => resumeAfterScopeChange(draftId ?? 'missing-draft'));
    expect(latest().composer).toBe('brand new agent draft');

    act(() => root?.render(<Harness state={sessionState} />));
    expect(latest().composer).toBe('existing session draft');
  });

  it('parks the current New Agent text before starting another New Agent draft', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn(),
    } as unknown as HostClient;
    const dispatch = vi.fn();
    let captured: ComposerMediaResult | undefined;

    const latest = (): ComposerMediaResult => {
      if (captured === undefined) {
        throw new Error('composer media hook was not rendered');
      }
      return captured;
    };

    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient,
        state: props.state,
        dispatch,
        agentMode: 'agent',
      });
      return null;
    }

    const newAgentState = {
      ...createInitialChatUiState(),
      activeSessionId: null,
    };
    act(() => root?.render(<Harness state={newAgentState} />));
    act(() => latest().setComposer('first unsent New Agent draft'));

    act(() => latest().startNewDraft());

    expect(latest().composer).toBe('');
    expect(latest().activeDraftId).toBeNull();
    expect(latest().draftSessions).toHaveLength(1);
    expect(latest().draftSessions[0]?.text).toBe('first unsent New Agent draft');

    const parkedDraftId = latest().draftSessions[0]?.id;
    expect(parkedDraftId).toBeDefined();
    act(() => latest().setComposer('second unsent New Agent draft'));
    act(() => latest().resumeDraft(parkedDraftId ?? 'missing-draft'));

    expect(latest().composer).toBe('first unsent New Agent draft');
    expect(latest().draftSessions).toHaveLength(2);
    expect(
      latest().draftSessions.some((draft) => draft.text === 'second unsent New Agent draft'),
    ).toBe(true);
  });

  it('parks and restores an image-only New Agent draft without creating a Host session', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = {
      request: vi.fn(),
    } as unknown as HostClient;
    // Production wiring passes ensureSession; the deferred path must not call
    // it until Send. The old test omitted it, which made a paste-time
    // session creation invisible.
    const ensureSession = vi.fn().mockResolvedValue('session-1');
    const dispatch = vi.fn();
    let captured: ComposerMediaResult | undefined;

    const latest = (): ComposerMediaResult => {
      if (captured === undefined) {
        throw new Error('composer media hook was not rendered');
      }
      return captured;
    };

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

    const newAgentState = {
      ...createInitialChatUiState(),
      activeSessionId: null,
    };
    const existingSessionState = {
      ...newAgentState,
      activeSessionId: 'existing-session',
    };
    act(() => root?.render(<Harness state={newAgentState} />));

    pasteImage(latest);

    expect(latest().pendingAttachments).toHaveLength(1);
    expect(latest().pendingAttachments[0]?.uploadStatus).toBe('queued');
    expect(hostClient.request).not.toHaveBeenCalled();
    expect(ensureSession).not.toHaveBeenCalled();

    act(() => root?.render(<Harness state={existingSessionState} />));

    expect(latest().pendingAttachments).toEqual([]);
    expect(latest().draftSessions).toHaveLength(1);
    expect(latest().draftSessions[0]?.name).toBe('screenshot.png');
    const draftId = latest().draftSessions[0]?.id;

    act(() => latest().resumeDraft(draftId ?? 'missing-draft'));

    expect(latest().composer).toBe('');
    expect(latest().pendingAttachments).toHaveLength(1);
    expect(latest().pendingAttachments[0]?.attachment).toMatchObject({
      kind: 'media',
      name: 'screenshot.png',
    });
    expect(latest().pendingAttachments[0]?.uploadStatus).toBe('queued');
    expect(hostClient.request).not.toHaveBeenCalled();
    expect(ensureSession).not.toHaveBeenCalled();
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
      ...createInitialChatUiState(),
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
      ...createInitialChatUiState(),
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
    const promptCalls = requestMock.mock.calls.filter(
      (call) => call[0]?.type === 'session/prompt',
    );
    expect(requestMock).toHaveBeenCalledOnce();
    expect(promptCalls).toHaveLength(1);
    const input = (promptCalls[0]?.[0] as Extract<
      Parameters<typeof requestMock>[0],
      { type: 'session/prompt' }
    >)?.input;
    expect(input?.contextRefs).toEqual([
      expect.objectContaining({ title: 'Original' }),
    ]);
    expect(input?.contextRefs).not.toEqual([expect.objectContaining({ title: 'Changed' })]);
  });

  it('runs media/save only at Send, after the session is resolved', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const requestCalls: string[] = [];
    const hostClient = {
      request: vi.fn(async (command: { type: string }) => {
        requestCalls.push(command.type);
        return createSavedMediaResponse(command.type);
      }),
    } as unknown as HostClient;
    const ensureSession = vi.fn().mockResolvedValue('session-1');
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

    const state = {
      ...createInitialChatUiState(),
      activeSessionId: null,
    };
    act(() => root?.render(<Harness state={state} />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };

    pasteImage(latest);

    // Paste alone must not touch the Host: no session, no media/save.
    expect(requestCalls).toEqual([]);
    expect(ensureSession).not.toHaveBeenCalled();

    await act(async () => {
      await latest().handleSend();
    });

    // Session first, then media/save, then session/prompt.
    expect(ensureSession).toHaveBeenCalledOnce();
    expect(requestCalls).toEqual(['media/save', 'session/prompt']);
    expect(latest().composer).toBe('');
    expect(latest().pendingAttachments).toEqual([]);
  });

  it('restores text and attachment chip when session/prompt fails; retry reuses the saved attachment', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let failPrompt = true;
    let mediaSaveCalls = 0;
    const hostClient = {
      request: vi.fn(async (command: { type: string }) => {
        if (command.type === 'media/save') {
          mediaSaveCalls += 1;
          return createSavedMediaResponse('media/save');
        }
        if (command.type === 'session/prompt') {
          if (failPrompt) {
            return {
              type: 'response',
              command: 'session/prompt',
              success: false,
              error: 'provider unavailable',
            };
          }
          return createSavedMediaResponse('session/prompt');
        }
        return createSavedMediaResponse(command.type);
      }),
    } as unknown as HostClient;
    const ensureSession = vi.fn().mockResolvedValue('session-1');
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

    const state = {
      ...createInitialChatUiState(),
      activeSessionId: null,
    };
    act(() => root?.render(<Harness state={state} />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };

    act(() => latest().setComposer('hello image'));
    pasteImage(latest);

    await act(async () => {
      await latest().handleSend();
    });

    // Prompt failed: text AND the saved chip must come back for Retry.
    expect(latest().composer).toBe('hello image');
    expect(latest().pendingAttachments).toHaveLength(1);
    expect(latest().pendingAttachments[0]?.uploadStatus).toBe('ready');
    expect(mediaSaveCalls).toBe(1);

    // Retry succeeds and reuses the already-saved attachment (no re-upload).
    failPrompt = false;
    await act(async () => {
      await latest().handleSend();
    });

    expect(latest().composer).toBe('');
    expect(latest().pendingAttachments).toEqual([]);
    expect(mediaSaveCalls).toBe(1);
    const requestMock = vi.mocked(hostClient.request);
    const promptCalls = requestMock.mock.calls.filter(
      (call) => call[0]?.type === 'session/prompt',
    );
    expect(promptCalls).toHaveLength(2);
    const secondInput = (promptCalls[1]?.[0] as {
      type: 'session/prompt';
      input: { attachments?: Array<{ kind: string }> };
    })?.input;
    expect(secondInput?.attachments).toEqual([expect.objectContaining({ kind: 'media' })]);
  });

  it('aborts before painting when a deferred media save fails and keeps the draft text', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const requestCalls: string[] = [];
    const hostClient = {
      request: vi.fn(async (command: { type: string }) => {
        requestCalls.push(command.type);
        if (command.type === 'media/save') {
          return {
            type: 'response',
            command: 'media/save',
            success: false,
            error: 'too-large',
          };
        }
        return createSavedMediaResponse(command.type);
      }),
    } as unknown as HostClient;
    const ensureSession = vi.fn().mockResolvedValue('session-1');
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

    const state = {
      ...createInitialChatUiState(),
      activeSessionId: null,
    };
    act(() => root?.render(<Harness state={state} />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };

    act(() => latest().setComposer('keep this text'));
    pasteImage(latest);

    await act(async () => {
      await latest().handleSend();
    });

    // Save failed: no optimistic bubble, no session/prompt, chip shows Retry.
    expect(requestCalls).toEqual(['media/save']);
    expect(latest().composer).toBe('keep this text');
    expect(latest().pendingAttachments).toHaveLength(1);
    expect(latest().pendingAttachments[0]?.uploadStatus).toBe('error');
  });

});

describe('useComposerMedia failed attachment policy (Phase 0)', () => {
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

  type FailedSendHarness = {
    latest: () => ComposerMediaResult;
    dispatch: ReturnType<typeof vi.fn>;
    requestCalls: () => string[];
    promptInputs: () => Array<{ attachments?: Array<{ kind: string }> }>;
    setMediaSaveBehavior: (behavior: 'reject' | 'throw' | 'succeed') => void;
  };

  /** Renders the hook bound to an active session and produces one failed chip. */
  async function setupWithFailedChip(): Promise<FailedSendHarness> {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let mediaSaveBehavior: 'reject' | 'throw' | 'succeed' = 'reject';
    const calls: string[] = [];
    const promptInputs: Array<{ attachments?: Array<{ kind: string }> }> = [];
    const hostClient = {
      request: vi.fn(async (command: { type: string; input?: unknown }) => {
        calls.push(command.type);
        if (command.type === 'media/save') {
          if (mediaSaveBehavior === 'throw') {
            throw new Error('socket closed');
          }
          if (mediaSaveBehavior === 'reject') {
            return {
              type: 'response',
              command: 'media/save',
              success: false,
              error: 'too-large',
            };
          }
          return createSavedMediaResponse('media/save');
        }
        if (command.type === 'session/prompt') {
          promptInputs.push(command.input as { attachments?: Array<{ kind: string }> });
        }
        return createSavedMediaResponse(command.type);
      }),
    } as unknown as HostClient;
    const dispatch = vi.fn();
    let captured: ComposerMediaResult | undefined;

    function Harness(): null {
      captured = useComposerMedia({
        hostClient,
        state: { ...createInitialChatUiState(), activeSessionId: 'session-1' },
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

    act(() => latest().setComposer('keep this text'));
    pasteImage(latest);
    await act(async () => {
      await latest().handleSend();
    });
    expect(latest().pendingAttachments[0]?.uploadStatus).toBe('error');

    return {
      latest,
      dispatch,
      requestCalls: () => calls,
      promptInputs: () => promptInputs,
      setMediaSaveBehavior: (behavior) => {
        mediaSaveBehavior = behavior;
      },
    };
  }

  it('never silently drops a failed chip: send stays blocked until the user decides', async () => {
    const harness = await setupWithFailedChip();
    harness.dispatch.mockClear();

    await act(async () => {
      await harness.latest().handleSend();
    });

    // No prompt was sent, the text and the failed chip are both still here.
    expect(harness.requestCalls().filter((type) => type === 'session/prompt')).toHaveLength(0);
    expect(harness.latest().composer).toBe('keep this text');
    expect(harness.latest().pendingAttachments).toHaveLength(1);
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('discardFailedAttachments removes failed chips synchronously for a same-tick send', async () => {
    const harness = await setupWithFailedChip();

    await act(async () => {
      harness.latest().discardFailedAttachments();
      await harness.latest().handleSend();
    });

    expect(harness.latest().pendingAttachments).toEqual([]);
    expect(harness.latest().composer).toBe('');
    expect(harness.promptInputs()).toHaveLength(1);
    expect(harness.promptInputs()[0]?.attachments).toBeUndefined();
  });

  it('retryFailedAttachments re-queues failed chips synchronously for a same-tick send', async () => {
    const harness = await setupWithFailedChip();
    harness.setMediaSaveBehavior('succeed');

    await act(async () => {
      harness.latest().retryFailedAttachments();
      await harness.latest().handleSend();
    });

    expect(harness.requestCalls().filter((type) => type === 'media/save')).toHaveLength(2);
    expect(harness.promptInputs()).toHaveLength(1);
    expect(harness.promptInputs()[0]?.attachments).toEqual([
      expect.objectContaining({ kind: 'media' }),
    ]);
    expect(harness.latest().pendingAttachments).toEqual([]);
  });

  it('tags Host-rejected saves as policy and transport failures as connection', async () => {
    const harness = await setupWithFailedChip();
    expect(harness.latest().pendingAttachments[0]?.uploadErrorKind).toBe('policy');

    harness.setMediaSaveBehavior('throw');
    await act(async () => {
      harness.latest().retryFailedAttachments();
      await harness.latest().handleSend();
    });

    expect(harness.latest().pendingAttachments[0]?.uploadStatus).toBe('error');
    expect(harness.latest().pendingAttachments[0]?.uploadErrorKind).toBe('connection');
  });
});
