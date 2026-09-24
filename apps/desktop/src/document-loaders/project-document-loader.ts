/**
 * `project-file` target loader (ADR 0052 §6 split).
 *
 * Owns "which project file does this click mean, and what bytes can we paint
 * for it?": the tool snapshot, the read (with ranged image assembly), the
 * bounded `find-file` retry for a message-written miss, and the local-file
 * last resort for a path that only exists outside the root's alias.
 *
 * `settle: false` is for callers that have somewhere else to look afterwards
 * (the legacy alias retry): nothing is painted, so a real reason from an
 * earlier attempt is never overwritten by a later miss.
 */
import { activeDocumentFromProjectRead } from '../preview-unavailable.js';
import { localPreviewPathForPlan, planDocumentOpenPath } from '../document-open-path.js';
import { readProjectPreviewWithFallback } from '../hooks/project-preview-open.js';
import {
  settleUnavailable,
  unavailableDocument,
  type DocumentLoaderContext,
} from './document-loader-context.js';
import { loadLocalFileDocument } from './local-file-document-loader.js';

export type ProjectLoadOutcome = 'ready' | 'unavailable' | 'none';

export type ProjectDocumentLoadInput = {
  relativePath: string;
  /**
   * Absolute path to try when the project read has no answer. Omitted means
   * "derive it from the project root and the relative path".
   */
  absolutePath?: string | null | undefined;
  /** Local-file retry when the project has nothing (legacy absolute chips). */
  allowLocalFileFallback?: boolean | undefined;
  /** Default true. False leaves the viewer untouched on a miss. */
  settle?: boolean | undefined;
};

export async function loadProjectDocument(
  context: DocumentLoaderContext,
  input: ProjectDocumentLoadInput,
): Promise<ProjectLoadOutcome> {
  const { relativePath } = input;
  const displayRef = context.displayRef || relativePath;
  const snapshot = await context.requestToolSnapshot(context.snapshotRequest);
  if (snapshot) {
    context.apply({
      status: 'ready',
      requestId: context.requestId,
      title: context.title,
      content: snapshot.content,
      displayRef,
      provenance: 'tool-snapshot',
      ...(snapshot.truncated ? { warning: '该次工具输出被截断，只展示部分内容。' } : {}),
    });
    return 'ready';
  }

  if (context.projectPath) {
    const preview = await readProjectPreviewWithFallback({
      hostClient: context.hostClient,
      projectPath: context.projectPath,
      relativePath,
      onPlaceholder: (placeholder) => {
        const next = activeDocumentFromProjectRead({
          data: placeholder,
          requestId: context.requestId,
          title: context.title,
          displayRef,
        });
        if (next) context.apply(next);
      },
    });
    if (preview.kind === 'read') {
      const next = activeDocumentFromProjectRead({
        data: preview.data,
        requestId: context.requestId,
        title: context.title,
        displayRef: preview.resolvedRelativePath ?? displayRef,
      });
      if (next) {
        context.apply(next);
        return 'ready';
      }
    } else if (preview.kind === 'ambiguous') {
      context.apply(unavailableDocument(context, { reason: 'ambiguous-file' }));
      return 'unavailable';
    } else if (preview.kind === 'missing-root') {
      context.apply(unavailableDocument(context, { reason: 'project-root-missing' }));
      return 'unavailable';
    }

    if (input.allowLocalFileFallback !== false) {
      const absolutePath =
        input.absolutePath ??
        localPreviewPathForPlan(
          planDocumentOpenPath({ path: relativePath, projectPath: context.projectPath }),
        );
      if (absolutePath && context.activeSessionId) {
        return await loadLocalFileDocument(context, {
          absolutePath,
          displayRef,
          transcriptFallback: false,
        });
      }
    }
  }

  if (input.settle === false) {
    return 'none';
  }
  settleUnavailable(context, {
    reason: 'not-found',
    suggestion: '确认文件仍存在于项目中。',
    warning: '展示来自对话记录的恢复内容，非当前磁盘版本。',
  });
  return 'unavailable';
}
