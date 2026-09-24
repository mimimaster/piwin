/**
 * `media` target loader (ADR 0052 §6 split).
 *
 * Remote-safe identity first: a structured media target addresses bytes by
 * session + asset id, so the viewer fetches them through `media/read` and never
 * sees a host path. A bare `remote-asset:<id>` path carries no session, and a
 * local vault path needs no round-trip at all (the Tauri asset protocol already
 * reads it).
 */
import type { ActiveDocument } from '../active-document.js';
import { readMediaObjectUrlViaHost } from '../media-host-read.js';
import type { DocumentLoaderContext } from './document-loader-context.js';
import { unavailableDocument } from './document-loader-context.js';

export async function loadMediaTargetDocument(
  context: DocumentLoaderContext,
  input: { sessionId: string; assetId: string; displayRef: string },
): Promise<void> {
  const objectUrl = await readMediaObjectUrlViaHost(context.hostClient, {
    sessionId: input.sessionId,
    assetId: input.assetId,
  });
  if (!objectUrl) {
    context.apply(
      unavailableDocument(
        { ...context, displayRef: input.displayRef },
        {
          reason: 'media-unavailable',
          suggestion: '该媒体资源无法读取，可能已被清理或不可用。',
        },
      ),
    );
    return;
  }
  context.apply({
    status: 'ready',
    requestId: context.requestId,
    title: context.title,
    content: '',
    displayRef: input.displayRef,
    provenance: 'session-media',
    media: { path: input.displayRef, assetId: input.assetId, dataUrl: objectUrl },
  });
}

/** A local vault path renders straight from the asset protocol — no IPC. */
export function vaultMediaDocument(context: DocumentLoaderContext, path: string): ActiveDocument {
  return {
    status: 'ready',
    requestId: context.requestId,
    title: context.title,
    content: '',
    displayRef: path,
    provenance: 'session-media',
    media: { path },
  };
}

/** An opaque `remote-asset:<id>` with no session has no readable bytes. */
export function unresolvableRemoteAssetDocument(context: DocumentLoaderContext): ActiveDocument {
  return unavailableDocument(context, {
    reason: 'media-unavailable',
    suggestion: '该资源缺少会话标识，无法读取；请通过工具卡中的媒体目标打开。',
  });
}
