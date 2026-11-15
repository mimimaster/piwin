// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ARTIFACT_READY_TIMEOUT_MS } from '@piwin/artifact';
import {
  usePublishedArtifactDocument,
  type ArtifactDocumentPublication,
} from './artifact-document-publication.js';

function deferred() {
  let resolve: () => void = () => {
    throw new Error('deferred not initialized');
  };
  let reject: (error: unknown) => void = () => {
    throw new Error('deferred not initialized');
  };
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('Artifact document publication ownership', () => {
  let root: Root;
  let container: HTMLDivElement;
  let latest: ArtifactDocumentPublication;
  let previousActEnvironment: boolean | undefined;
  const invoke = vi.fn<(command: string, args: unknown) => Promise<unknown>>();

  function Probe(props: { id: string; hosted: boolean }): ReactElement | null {
    latest = usePublishedArtifactDocument(
      {
        documentId: props.id,
        documentKey: props.id,
        documentSource: `<p>${props.id}</p>`,
        documentUrl: `about:blank#${props.id}`,
        streamLifecycle: false,
        streamSeeded: false,
      },
      props.hosted,
    );
    return null;
  }

  async function render(id: string, hosted = true): Promise<void> {
    await act(async () => {
      root.render(<Probe id={id} hosted={hosted} />);
    });
  }

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invoke.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('does not let an old document ACK certify a replacement', async () => {
    const first = deferred();
    const second = deferred();
    invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render('document-first-0000');
    await render('document-second-000');
    await act(async () => {
      first.resolve();
    });
    expect(latest.status).toBe('publishing');
    await act(async () => {
      second.resolve();
    });
    expect(latest.status).toBe('ready');
  });

  it('ignores an old rejection after the replacement has published', async () => {
    const first = deferred();
    invoke.mockReturnValueOnce(first.promise).mockResolvedValueOnce(null);
    await render('document-first-0000');
    await render('document-second-000');
    expect(latest.status).toBe('ready');
    await act(async () => {
      first.reject(new Error('old failure'));
    });
    expect(latest.status).toBe('ready');
    expect(latest.error).toBeNull();
  });

  it('republishes and waits for a fresh ACK when re-hosted after recycling', async () => {
    const rehost = deferred();
    invoke.mockResolvedValueOnce(null).mockReturnValueOnce(rehost.promise);
    await render('document-first-0000');
    expect(latest.status).toBe('ready');
    await render('document-first-0000', false);
    expect(latest.status).toBe('idle');
    await render('document-first-0000');
    expect(latest.status).toBe('publishing');
    expect(invoke).toHaveBeenCalledTimes(2);
    await act(async () => {
      rehost.resolve();
    });
    expect(latest.status).toBe('ready');
  });

  it('offers recovery after a lost ACK and ignores the late completion', async () => {
    vi.useFakeTimers();
    const lost = deferred();
    const retry = deferred();
    invoke.mockReturnValueOnce(lost.promise).mockReturnValueOnce(retry.promise);
    await render('document-first-0000');
    await act(async () => {
      vi.advanceTimersByTime(ARTIFACT_READY_TIMEOUT_MS);
    });
    expect(latest.status).toBe('error');
    expect(latest.error).toBe('unavailable');
    await act(async () => {
      latest.retry();
    });
    expect(latest.status).toBe('publishing');
    await act(async () => {
      lost.resolve();
    });
    expect(latest.status).toBe('publishing');
    await act(async () => {
      retry.resolve();
    });
    expect(latest.status).toBe('ready');
  });

  it('does not publish again for equivalent parent renders', async () => {
    invoke.mockResolvedValue(null);
    await render('document-first-0000');
    await render('document-first-0000');
    expect(latest.status).toBe('ready');
    expect(invoke).toHaveBeenCalledOnce();
  });
});
