/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ARTIFACT_HANDOFF_LOAD_TIMEOUT_MS,
  ARTIFACT_HANDOFF_RESTORE_TIMEOUT_MS,
  ARTIFACT_HANDOFF_REVEAL_DELAY_MS,
  useArtifactDocumentHandoff,
  type ArtifactDocumentHandoff,
} from './artifact-document-handoff.js';
import type { ArtifactDocument } from './artifact-frame-stream.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeDocument(id: string): ArtifactDocument {
  return {
    documentKey: `key-${id}`,
    documentId: id,
    documentSource: `<p>${id}</p>`,
    documentUrl: `data:text/html,${id}`,
    streamLifecycle: false,
    streamSeeded: false,
  };
}

type Posted = { type: string; channelId: string; top?: number };

let latest: ArtifactDocumentHandoff | null = null;
let incomingPosts: Posted[] = [];
let outgoingPosts: Posted[] = [];

function fakeFrame(posts: Posted[]): HTMLIFrameElement {
  return {
    contentWindow: { postMessage: (message: Posted) => posts.push(message) },
  } as unknown as HTMLIFrameElement;
}

function Probe(props: { document: ArtifactDocument; enabled: boolean }): ReactElement | null {
  const iframeRef = useRef<HTMLIFrameElement | null>(fakeFrame(incomingPosts));
  const handoff = useArtifactDocumentHandoff({
    channelId: 'channel-1',
    document: props.document,
    iframeRef,
    enabled: props.enabled,
  });
  handoff.outgoingRef.current = handoff.outgoing ? fakeFrame(outgoingPosts) : null;
  latest = handoff;
  return null;
}

function reportScroll(top: number, restored = false, channelId = 'channel-1'): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'piwin-artifact:scroll', channelId, top, restored },
        source: null,
      }),
    );
  });
}

describe('useArtifactDocumentHandoff', () => {
  let root: Root;
  let container: HTMLDivElement;

  const render = (document: ArtifactDocument, enabled = true): void => {
    act(() => root.render(<Probe document={document} enabled={enabled} />));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    latest = null;
    incomingPosts = [];
    outgoingPosts = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('keeps nothing on screen for a document the reader never saw', () => {
    render(makeDocument('a'));
    render(makeDocument('b'));
    expect(latest?.outgoing).toBeNull();
  });

  it('keeps the loaded document, retires it, and restores the reading position', () => {
    render(makeDocument('a'));
    act(() => latest?.onIncomingLoad());
    reportScroll(640);

    render(makeDocument('b'));
    expect(latest?.outgoing?.documentId).toBe('a');
    expect(outgoingPosts).toEqual([{ type: 'piwin-artifact:retire', channelId: 'channel-1' }]);

    act(() => latest?.onIncomingLoad());
    expect(incomingPosts).toEqual([
      { type: 'piwin-artifact:scroll-restore', channelId: 'channel-1', top: 640 },
    ]);
    expect(latest?.outgoing?.documentId).toBe('a');

    reportScroll(640, true);
    expect(latest?.outgoing?.documentId).toBe('a');
    act(() => vi.advanceTimersByTime(ARTIFACT_HANDOFF_REVEAL_DELAY_MS));
    expect(latest?.outgoing).toBeNull();
  });

  it('reveals a successor straight away when the reader was at the top', () => {
    render(makeDocument('a'));
    act(() => latest?.onIncomingLoad());
    render(makeDocument('b'));
    act(() => latest?.onIncomingLoad());
    expect(incomingPosts).toEqual([]);
    act(() => vi.advanceTimersByTime(ARTIFACT_HANDOFF_REVEAL_DELAY_MS));
    expect(latest?.outgoing).toBeNull();
  });

  it('drops the outgoing document when the successor never loads or never answers', () => {
    render(makeDocument('a'));
    act(() => latest?.onIncomingLoad());
    reportScroll(300);
    render(makeDocument('b'));
    act(() => vi.advanceTimersByTime(ARTIFACT_HANDOFF_LOAD_TIMEOUT_MS));
    expect(latest?.outgoing).toBeNull();

    render(makeDocument('c'));
    expect(latest?.outgoing).toBeNull();
    act(() => latest?.onIncomingLoad());
    render(makeDocument('d'));
    act(() => latest?.onIncomingLoad());
    expect(latest?.outgoing?.documentId).toBe('c');
    act(() => vi.advanceTimersByTime(ARTIFACT_HANDOFF_RESTORE_TIMEOUT_MS));
    expect(latest?.outgoing).toBeNull();
  });

  it('ignores scroll reports from other channels and does nothing when disabled', () => {
    render(makeDocument('a'));
    act(() => latest?.onIncomingLoad());
    reportScroll(900, false, 'someone-else');
    render(makeDocument('b'));
    act(() => latest?.onIncomingLoad());
    expect(incomingPosts).toEqual([]);

    act(() => vi.advanceTimersByTime(ARTIFACT_HANDOFF_REVEAL_DELAY_MS));
    render(makeDocument('c'), false);
    expect(latest?.outgoing).toBeNull();
  });
});
