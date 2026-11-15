import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { MAX_ARTIFACT_DOCUMENT_BYTES } from '@piwin/contracts';
import { ARTIFACT_READY_TIMEOUT_MS } from '@piwin/artifact';
import { hasTauriBridge } from '../tool-cards/shell-runtime.js';
import { resolveArtifactDocumentByteLimit, type ArtifactDocument } from './artifact-document.js';

export type ArtifactDocumentFailure = 'too-large' | 'unavailable';

export type ArtifactDocumentPublication = {
  status: 'idle' | 'publishing' | 'ready' | 'error';
  error: ArtifactDocumentFailure | null;
  retry: () => void;
};

class ArtifactDocumentSizeError extends Error {
  override name = 'ArtifactDocumentSizeError';
  constructor() {
    super('artifact document too large');
  }
}

function documentExceedsLimit(source: string, maximumBytes = MAX_ARTIFACT_DOCUMENT_BYTES): boolean {
  return new TextEncoder().encode(source).byteLength > maximumBytes;
}

export async function publishArtifactDocument(documentId: string, srcdoc: string): Promise<void> {
  if (documentExceedsLimit(srcdoc)) throw new ArtifactDocumentSizeError();
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('artifact_document_put', { id: documentId, html: srcdoc });
}

/** A new document, re-host or explicit retry must earn its own publication ACK. */
export function usePublishedArtifactDocument(
  document: ArtifactDocument,
  hosted: boolean,
): ArtifactDocumentPublication {
  const { documentId, documentSource } = document;
  const [attempt, setAttempt] = useState(0);
  const request = useMemo(
    () => ({ documentId, documentSource, hosted, attempt }),
    [documentId, documentSource, hosted, attempt],
  );
  const maximumBytes = resolveArtifactDocumentByteLimit();
  const oversized = useMemo(
    () => documentExceedsLimit(documentSource, maximumBytes),
    [documentSource, maximumBytes],
  );
  const tauri = hasTauriBridge();
  const [settled, setSettled] = useState<{
    request: typeof request;
    error: ArtifactDocumentFailure | null;
  } | null>(null);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useLayoutEffect(() => {
    if (!hosted || oversized || !tauri) return;
    let disposed = false;
    const timeout = setTimeout(() => {
      disposed = true;
      console.warn('Artifact document publication timed out.');
      setSettled({ request, error: 'unavailable' });
    }, ARTIFACT_READY_TIMEOUT_MS);
    void publishArtifactDocument(documentId, documentSource).then(
      () => {
        if (!disposed) {
          clearTimeout(timeout);
          setSettled({ request, error: null });
        }
      },
      (error: unknown) => {
        console.warn('Unable to publish Artifact document.', error);
        if (!disposed) {
          clearTimeout(timeout);
          setSettled({
            request,
            error:
              error instanceof ArtifactDocumentSizeError || error === 'artifact document too large'
                ? 'too-large'
                : 'unavailable',
          });
        }
      },
    );
    return () => {
      disposed = true;
      clearTimeout(timeout);
    };
  }, [documentId, documentSource, hosted, oversized, request, tauri]);

  if (!hosted) return { status: 'idle', error: null, retry };
  if (oversized) return { status: 'error', error: 'too-large', retry };
  if (!tauri) return { status: 'ready', error: null, retry };
  if (settled?.request !== request) return { status: 'publishing', error: null, retry };
  return { status: settled.error === null ? 'ready' : 'error', error: settled.error, retry };
}
