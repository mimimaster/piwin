// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PromptContextRef } from '@piwin/contracts';
import { createInitialChatUiState, type ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import * as previewBitmap from '../media-preview-bitmap.js';
import {
  MAX_RETAINED_SESSION_COMPOSER_SNAPSHOTS,
  useComposerMedia,
} from './use-composer-media';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  if (commandType === 'media/save' || commandType === 'media/save-finish') {
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
  if (commandType === 'media/save-begin') {
    return {
      type: 'response' as const,
      command: commandType,
      success: true,
      data: { uploadId: 'upload-1', chunkMaxBytes: 384 * 1024 },
    };
  }
  if (commandType === 'media/save-chunk') {
    return {
      type: 'response' as const,
      command: commandType,
      success: true,
      data: { uploadId: 'upload-1', receivedBytes: 4 },
    };
  }
  if (commandType === 'media/save-abort') {
    return {
      type: 'response' as const,
      command: commandType,
      success: true,
      data: { uploadId: 'upload-1' },
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

  it('caps session composer snapshots and revokes evicted attachment blobs', () => {
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

    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((obj: Blob | MediaSource) => `blob:mock-${(obj as File).name}`);
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const stateFor = (sessionId: string): ChatUiState => ({
      ...createInitialChatUiState(),
      activeSessionId: sessionId,
    });

    act(() => root?.render(<Harness state={stateFor('session-s0')} />));
    pasteImage(latest);
    act(() => latest().setComposer('unsent text for s0'));
    expect(latest().pendingAttachments).toHaveLength(1);

    // Leave enough sessions to push session-s0's snapshot past the LRU cap.
    for (let index = 1; index <= MAX_RETAINED_SESSION_COMPOSER_SNAPSHOTS; index += 1) {
      const sessionId = `session-s${index}`;
      act(() => root?.render(<Harness state={stateFor(sessionId)} />));
      act(() => latest().setComposer(`unsent text for ${sessionId}`));
    }
    // Snapshots now hold s0..s7 (cap). Leaving s8 evicts s0 and must release
    // its pinned blob instead of keeping the original image resident forever.
    act(() => root?.render(<Harness state={stateFor('session-s9')} />));

    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:mock-screenshot.png');

    // The evicted session restores an empty composer.
    act(() => root?.render(<Harness state={stateFor('session-s0')} />));
    expect(latest().composer).toBe('');
    expect(latest().pendingAttachments).toEqual([]);

    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });

  it('does not put the original File object URL on the composer chip preview', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = { request: vi.fn() } as unknown as HostClient;
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

    const beginSpy = vi
      .spyOn(previewBitmap, 'beginComposerImagePreview')
      .mockImplementation((file, onReady, isCancelled) => {
        queueMicrotask(() => {
          if (!isCancelled()) {
            onReady('blob:limited');
          }
        });
        return { lightboxUrl: `blob:mock-${file.name}` };
      });

    act(() =>
      root?.render(
        <Harness
          state={{
            ...createInitialChatUiState(),
            activeSessionId: 'session-preview',
          }}
        />,
      ),
    );
    pasteImage(latest);
    await act(async () => {
      await Promise.resolve();
    });

    const chip = latest().pendingAttachments[0];
    expect(chip?.lightboxUrl).toBe('blob:mock-screenshot.png');
    expect(chip?.previewUrl).toBe('blob:limited');
    expect(chip?.previewUrl).not.toBe(chip?.lightboxUrl);

    beginSpy.mockRestore();
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

    const state = { ...createInitialChatUiState(), activeSessionId: 'session-1' };
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
    expect(requestCalls).toEqual([
      'media/save-begin',
      'media/save-chunk',
      'media/save-finish',
      'session/prompt',
    ]);
    expect(latest().composer).toBe('');
    expect(latest().pendingAttachments).toEqual([]);
  });

  it('sends remote-asset refs when media/save omits Host paths', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    let promptAttachments: Array<{ path?: string }> | undefined;
    const hostClient = {
      request: vi.fn(async (command: { type: string; input?: { attachments?: Array<{ path?: string }> } }) => {
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
    expect(requestCalls[0]).toBe('media/save-begin');
    expect(requestCalls).not.toContain('session/prompt');
    expect(latest().composer).toBe('keep this text');
    expect(latest().pendingAttachments).toHaveLength(1);
    expect(latest().pendingAttachments[0]?.uploadStatus).toBe('error');
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
          ...createInitialChatUiState(),
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
          ...createInitialChatUiState(),
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
          ...createInitialChatUiState(),
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
      | { type: 'session/prompt'; input?: Record<string, unknown> }
      | undefined;
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
          ...createInitialChatUiState(),
          activeSessionId: 'conversation-1',
          activeScope: { kind: 'general' },
        },
        dispatch: vi.fn(),
        agentMode: 'plan',
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
          ...createInitialChatUiState(),
          activeSessionId: 'project-1',
          projectPath: '/tmp/piwin-project',
          projectTrusted: true,
          activeScope: { kind: 'project', projectPath: '/tmp/piwin-project' },
        },
        dispatch: vi.fn(),
        agentMode: 'plan',
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
    expect(input.agentMode).toBe('plan');
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
      ...createInitialChatUiState(),
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
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'user/send-rollback' }),
    );
  });
});
