/**
 * `local-file` target loader (ADR 0052 §6 split).
 *
 * The Host resolves a clicked host path to a `local-file` target for a local
 * shell; this loader turns it into painted bytes — raster images are ingested
 * into the session media vault, text opens read-only. A remote shell never
 * receives this target (see `denyRemoteLocalFileTarget`).
 *
 * Returns its outcome so callers that have another place to look (the legacy
 * alias retry) can decide for themselves; `transcriptFallback` opts into the
 * shared conversation ladder.
 */
import type { DocumentLoaderContext } from './document-loader-context.js';
import { settleUnavailable, unavailableDocument } from './document-loader-context.js';

export type LocalFileLoadOutcome = 'ready' | 'unavailable';

export async function loadLocalFileDocument(
  context: DocumentLoaderContext,
  input: { absolutePath: string; displayRef?: string; transcriptFallback?: boolean },
): Promise<LocalFileLoadOutcome> {
  const loaderContext: DocumentLoaderContext =
    input.displayRef === undefined ? context : { ...context, displayRef: input.displayRef };

  const response = await loaderContext.hostClient.request({
    type: 'preview/read-local-file',
    input: { sessionId: loaderContext.activeSessionId ?? '', absolutePath: input.absolutePath },
  });

  if (response.success && response.data) {
    const previewData = response.data as {
      status?: string;
      kind?: string;
      content?: string;
      truncated?: boolean;
      asset?: {
        id?: string;
        absolutePath?: string;
        mimeType?: string;
        byteSize?: number;
      };
      reason?: string;
      suggestion?: string;
    };
    if (
      previewData.status === 'ready' &&
      previewData.kind === 'media' &&
      typeof previewData.asset?.absolutePath === 'string' &&
      previewData.asset.absolutePath.length > 0
    ) {
      loaderContext.apply({
        status: 'ready',
        requestId: loaderContext.requestId,
        title: loaderContext.title,
        content: '',
        displayRef: loaderContext.displayRef,
        provenance: 'session-media',
        media: {
          path: previewData.asset.absolutePath,
          ...(typeof previewData.asset.id === 'string' ? { assetId: previewData.asset.id } : {}),
          ...(typeof previewData.asset.mimeType === 'string'
            ? { mimeType: previewData.asset.mimeType }
            : {}),
          ...(typeof previewData.asset.byteSize === 'number'
            ? { byteSize: previewData.asset.byteSize }
            : {}),
        },
      });
      return 'ready';
    }
    if (
      previewData.status === 'ready' &&
      previewData.kind === 'text' &&
      typeof previewData.content === 'string'
    ) {
      loaderContext.apply({
        status: 'ready',
        requestId: loaderContext.requestId,
        title: loaderContext.title,
        content: previewData.content,
        displayRef: loaderContext.displayRef,
        provenance: 'project-current',
        readOnly: true,
        ...(previewData.truncated === true ? { warning: '内容已截断，只展示部分文本。' } : {}),
      });
      return 'ready';
    }
    if (previewData.status === 'unavailable') {
      const suggestion =
        previewData.suggestion ||
        (previewData.reason === 'binary'
          ? '该文件无法作为文档预览。请右键路径芯片选择另存为，或在文件管理器中显示。'
          : undefined);
      const reason = previewData.reason || 'not-found';
      if (input.transcriptFallback === true) {
        settleUnavailable(loaderContext, {
          reason,
          ...(suggestion !== undefined ? { suggestion } : {}),
          warning: '展示来自对话记录的恢复内容。',
        });
        return 'unavailable';
      }
      loaderContext.apply(unavailableDocument(loaderContext, { reason, suggestion }));
      return 'unavailable';
    }
  }

  if (input.transcriptFallback === true) {
    settleUnavailable(loaderContext, {
      reason: 'not-found',
      suggestion: '该文件当前无法读取。',
      warning: '展示来自对话记录的恢复内容。',
    });
    return 'unavailable';
  }
  loaderContext.apply(
    unavailableDocument(loaderContext, { reason: 'not-found', suggestion: '该文件当前无法读取。' }),
  );
  return 'unavailable';
}
