// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import { useComposerMedia } from './use-composer-media';
import {
  createInitialTestChatUiState,
  createSavedMediaResponse,
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
      ...createInitialTestChatUiState(),
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
    expect(requestCalls).toEqual([
      'media/save-begin',
      'media/save-chunk',
      'media/save-finish',
      'session/prompt',
    ]);
    const mediaFinishAt = requestCalls.indexOf('media/save-finish');
    const promptAt = requestCalls.indexOf('session/prompt');
    expect(mediaFinishAt).toBeGreaterThanOrEqual(0);
    expect(promptAt).toBeGreaterThan(mediaFinishAt);
    expect(latest().pendingAttachments.some((item) => item.uploadErrorKind === 'local')).toBe(
      false,
    );
    expect(latest().composer).toBe('');
    expect(latest().pendingAttachments).toEqual([]);
  });

  it('does not mark a New Agent paste as attachmentSourceMissing on immediate Send', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const requestCalls: string[] = [];
    const dispatch = vi.fn();
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
        dispatch,
        agentMode: 'agent',
        ensureSession,
      });
      return null;
    }

    const state = {
      ...createInitialTestChatUiState(),
      activeSessionId: null,
    };
    act(() => root?.render(<Harness state={state} />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };

    pasteImage(latest);
    await act(async () => {
      await latest().handleSend();
    });

    expect(
      latest().pendingAttachments.some(
        (item) => item.uploadErrorKind === 'local' || item.uploadStatus === 'error',
      ),
    ).toBe(false);
    expect(
      dispatch.mock.calls.some((call) => {
        const action = call[0] as { type?: string; message?: string };
        return action.type === 'error';
      }),
    ).toBe(false);
    expect(requestCalls.includes('media/save-finish')).toBe(true);
    expect(requestCalls.indexOf('session/prompt')).toBeGreaterThan(
      requestCalls.indexOf('media/save-finish'),
    );
  });

  it('keeps the source File after switching away from an existing session and back', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const requestCalls: string[] = [];
    const dispatch = vi.fn();
    const hostClient = {
      request: vi.fn(async (command: { type: string }) => {
        requestCalls.push(command.type);
        return createSavedMediaResponse(command.type);
      }),
    } as unknown as HostClient;
    let captured: ComposerMediaResult | undefined;

    function Harness(props: { state: ChatUiState }): null {
      captured = useComposerMedia({
        hostClient,
        state: props.state,
        dispatch,
        agentMode: 'agent',
      });
      return null;
    }

    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };
    const sessionAState = {
      ...createInitialTestChatUiState(),
      activeSessionId: 'session-a',
    };
    const sessionBState = {
      ...sessionAState,
      activeSessionId: 'session-b',
    };
    const draftGapState = {
      ...sessionAState,
      activeSessionId: null,
    };

    act(() => root?.render(<Harness state={sessionAState} />));
    pasteImage(latest);
    act(() => root?.render(<Harness state={draftGapState} />));
    act(() => root?.render(<Harness state={sessionBState} />));
    act(() => root?.render(<Harness state={draftGapState} />));
    act(() => root?.render(<Harness state={sessionAState} />));

    await act(async () => {
      await latest().handleSend();
    });

    expect(requestCalls).toEqual([
      'media/save-begin',
      'media/save-chunk',
      'media/save-finish',
      'session/prompt',
    ]);
    expect(latest().pendingAttachments).toEqual([]);
    expect(
      dispatch.mock.calls.some((call) => {
        const action = call[0] as { type?: string; message?: string };
        return action.type === 'error';
      }),
    ).toBe(false);
  });

  it('sends remote-asset refs when media/save omits Host paths', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let promptAttachments: Array<{ path?: string }> | undefined;
    const hostClient = {
      request: vi.fn(
        async (command: { type: string; input?: { attachments?: Array<{ path?: string }> } }) => {
          if (command.type === 'media/save-finish' || command.type === 'media/save') {
            return {
              type: 'response' as const,
              command: command.type,
              success: true,
              data: {
                asset: {
                  id: 'asset-remote-1',
                  mimeType: 'image/png',
                  byteSize: 4,
                  contentKind: 'image',
                  name: 'screenshot.png',
                },
              },
            };
          }
          if (command.type === 'session/prompt') {
            promptAttachments = command.input?.attachments;
            return createSavedMediaResponse('session/prompt');
          }
          return createSavedMediaResponse(command.type);
        },
      ),
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
      ...createInitialTestChatUiState(),
      activeSessionId: 'session-1',
    };
    act(() => root?.render(<Harness state={state} />));
    const latest = (): ComposerMediaResult => {
      if (captured === undefined) throw new Error('hook not rendered');
      return captured;
    };

    pasteImage(latest);
    await act(async () => {
      await latest().handleSend();
    });

    expect(promptAttachments).toEqual([
      expect.objectContaining({ id: 'asset-remote-1', path: 'remote-asset:asset-remote-1' }),
    ]);
  });

  it('restores text and attachment chip when session/prompt fails; retry reuses the saved attachment', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let failPrompt = true;
    let mediaSaveCalls = 0;
    const hostClient = {
      request: vi.fn(async (command: { type: string }) => {
        if (command.type === 'media/save-finish' || command.type === 'media/save') {
          mediaSaveCalls += 1;
          return createSavedMediaResponse(command.type);
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
      ...createInitialTestChatUiState(),
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
    const promptCalls = requestMock.mock.calls.filter((call) => call[0]?.type === 'session/prompt');
    expect(promptCalls).toHaveLength(2);
    const secondInput = (
      promptCalls[1]?.[0] as {
        type: 'session/prompt';
        input: { attachments?: Array<{ kind: string }> };
      }
    )?.input;
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
        if (
          command.type === 'media/save-begin' ||
          command.type === 'media/save' ||
          command.type === 'media/save-finish'
        ) {
          return {
            type: 'response',
            command: command.type,
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
      ...createInitialTestChatUiState(),
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
    expect(requestCalls[0]).toBe('media/save-begin');
    expect(requestCalls).not.toContain('session/prompt');
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
        if (
          command.type === 'media/save-begin' ||
          command.type === 'media/save' ||
          command.type === 'media/save-finish' ||
          command.type === 'media/save-chunk' ||
          command.type === 'media/save-abort'
        ) {
          if (mediaSaveBehavior === 'throw') {
            throw new Error('socket closed');
          }
          if (mediaSaveBehavior === 'reject' && command.type === 'media/save-begin') {
            return {
              type: 'response',
              command: command.type,
              success: false,
              error: 'too-large',
            };
          }
          return createSavedMediaResponse(command.type);
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
        state: { ...createInitialTestChatUiState(), activeSessionId: 'session-1' },
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
    expect(harness.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
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

    expect(harness.requestCalls().filter((type) => type === 'media/save-finish')).toHaveLength(1);
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
