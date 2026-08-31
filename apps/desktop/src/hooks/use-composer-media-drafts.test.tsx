// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatUiState } from '../chat-reducer';
import type { HostClient } from '../host-client';
import * as previewBitmap from '../media-preview-bitmap.js';
import {
  MAX_RETAINED_SESSION_COMPOSER_SNAPSHOTS,
  useComposerMedia,
} from './use-composer-media';
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
      ...createInitialTestChatUiState(),
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

  it('keeps unsent text and images when a session switch passes through draft mode', () => {
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

    const sessionAState = {
      ...createInitialTestChatUiState(),
      activeSessionId: 'session-a',
    };
    const draftGapState = {
      ...sessionAState,
      activeSessionId: null,
    };
    const sessionBState = {
      ...sessionAState,
      activeSessionId: 'session-b',
    };

    act(() => root?.render(<Harness state={sessionAState} />));
    act(() => latest().setComposer('unsent text for session A'));
    pasteImage(latest);
    expect(latest().pendingAttachments).toHaveLength(1);

    // project/set and project/clear null activeSessionId before the next
    // session/set. That gap must not drop the parked composer snapshot.
    act(() => root?.render(<Harness state={draftGapState} />));
    act(() => root?.render(<Harness state={sessionBState} />));
    expect(latest().composer).toBe('');
    expect(latest().pendingAttachments).toEqual([]);

    act(() => root?.render(<Harness state={sessionAState} />));
    expect(latest().composer).toBe('unsent text for session A');
    expect(latest().pendingAttachments).toHaveLength(1);
    expect(latest().pendingAttachments[0]?.attachment).toMatchObject({
      kind: 'media',
      name: 'screenshot.png',
    });
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
      ...createInitialTestChatUiState(),
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
            ...createInitialTestChatUiState(),
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

  it('inserts a selected New Agent draft row as soon as the composer has content', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = { request: vi.fn() } as unknown as HostClient;
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
        dispatch: vi.fn(),
        agentMode: 'agent',
      });
      return null;
    }

    const newAgentState = {
      ...createInitialTestChatUiState(),
      activeSessionId: null,
    };
    act(() => root?.render(<Harness state={newAgentState} />));
    expect(latest().draftSessions).toEqual([]);

    act(() => latest().setComposer('hello draft'));
    expect(latest().draftSessions).toHaveLength(1);
    expect(latest().draftSessions[0]?.text).toBe('hello draft');
    expect(latest().draftSessions[0]?.scope).toEqual({ kind: 'general' });
    expect(latest().activeDraftId).toBe(latest().draftSessions[0]?.id);

    const draftId = latest().draftSessions[0]?.id;
    act(() => latest().setComposer('hello draft changed'));
    expect(latest().draftSessions).toHaveLength(1);
    expect(latest().draftSessions[0]?.id).toBe(draftId);
    expect(latest().draftSessions[0]?.text).toBe('hello draft changed');
    expect(latest().activeDraftId).toBe(draftId);

    act(() => latest().setComposer(''));
    expect(latest().draftSessions).toEqual([]);
    expect(latest().activeDraftId).toBeNull();
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
      ...createInitialTestChatUiState(),
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
    expect(latest().draftSessions).toHaveLength(1);
    expect(latest().draftSessions[0]?.text).toBe('brand new agent draft');
    expect(latest().activeDraftId).toBe(latest().draftSessions[0]?.id);
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

  it('resumes the parked New Agent draft for this scope when leaving a session', () => {
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

    const sessionState = {
      ...createInitialTestChatUiState(),
      activeSessionId: 'existing-session',
    };
    const newAgentState = {
      ...sessionState,
      activeSessionId: null,
    };

    act(() => root?.render(<Harness state={newAgentState} />));
    act(() => latest().setComposer('unsent new agent prompt'));
    pasteImage(latest);
    expect(latest().draftSessions).toHaveLength(1);
    expect(latest().activeDraftId).toBe(latest().draftSessions[0]?.id);

    act(() => root?.render(<Harness state={sessionState} />));
    expect(latest().composer).toBe('');
    expect(latest().draftSessions).toHaveLength(1);

    act(() => latest().startNewDraft());
    act(() => root?.render(<Harness state={newAgentState} />));

    expect(latest().composer).toBe('unsent new agent prompt');
    expect(latest().pendingAttachments).toHaveLength(1);
    expect(latest().pendingAttachments[0]?.attachment).toMatchObject({
      kind: 'media',
      name: 'screenshot.png',
    });
    expect(latest().draftSessions).toHaveLength(1);
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
      ...createInitialTestChatUiState(),
      activeSessionId: null,
    };
    act(() => root?.render(<Harness state={newAgentState} />));
    act(() => latest().setComposer('first unsent New Agent draft'));
    expect(latest().draftSessions).toHaveLength(1);
    expect(latest().activeDraftId).toBe(latest().draftSessions[0]?.id);

    act(() => latest().startNewDraft());

    expect(latest().composer).toBe('');
    expect(latest().activeDraftId).toBeNull();
    expect(latest().draftSessions).toHaveLength(1);
    expect(latest().draftSessions[0]?.text).toBe('first unsent New Agent draft');

    const parkedDraftId = latest().draftSessions[0]?.id;
    expect(parkedDraftId).toBeDefined();
    act(() => latest().setComposer('second unsent New Agent draft'));
    expect(latest().draftSessions).toHaveLength(2);
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
      ...createInitialTestChatUiState(),
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
    expect(latest().draftSessions).toHaveLength(1);
    expect(latest().draftSessions[0]?.name).toBe('screenshot.png');
    expect(latest().activeDraftId).toBe(latest().draftSessions[0]?.id);
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

  it('revokes attachment blobs when a New Agent image draft is discarded', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const hostClient = { request: vi.fn() } as unknown as HostClient;
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
        dispatch: vi.fn(),
        agentMode: 'agent',
      });
      return null;
    }
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((obj: Blob | MediaSource) => `blob:mock-${(obj as File).name}`);
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    act(() =>
      root?.render(
        <Harness state={{ ...createInitialTestChatUiState(), activeSessionId: null }} />,
      ),
    );
    pasteImage(latest);
    expect(latest().draftSessions).toHaveLength(1);
    const localId = latest().pendingAttachments[0]?.localId;
    expect(localId).toBeDefined();
    act(() => latest().revokePending(localId ?? 'missing'));
    expect(latest().pendingAttachments).toEqual([]);
    expect(latest().draftSessions).toEqual([]);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:mock-screenshot.png');
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });

});
