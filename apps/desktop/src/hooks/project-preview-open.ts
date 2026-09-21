/**
 * Project-file reads for Doc Preview, including the message-written miss.
 *
 * Extracted from `use-active-document` (line budget + one responsibility):
 * everything here answers "which project file does this click mean, and what
 * bytes can we paint for it?"
 *
 * A chip can carry text the agent wrote rather than a path (`shot.png` while
 * the file lives in a subfolder), so a plain read miss is handed to
 * `project/find-file` before anything reports "not found". Only an
 * unambiguous, complete search is used; several matches are reported as such
 * and an incomplete walk resolves nothing.
 */
import type { HostClient } from '../host-client';
import type { ProjectReadPreviewInput } from '../preview-unavailable.js';
import { completeProjectImagePreview, predecodeImage } from '../project-image-preview-read.js';
import { resolveProjectFilePath } from '../resolve-project-file.js';

export type ProjectPreviewOpenResult =
  | {
      kind: 'read';
      data: ProjectReadPreviewInput;
      /** Set when the read only succeeded at a resolved path. */
      resolvedRelativePath?: string;
    }
  | { kind: 'ambiguous'; relativePaths: string[] }
  /** The registered workspace directory itself is gone (temp cleanup). */
  | { kind: 'missing-root' }
  | { kind: 'none' };

/**
 * `project/read-file`, with oversized image previews assembled from ranged
 * slices. Null on failure so callers fall through to their other sources.
 */
export async function readProjectPreviewData(
  hostClient: HostClient,
  projectPath: string,
  relativePath: string,
  onPlaceholder?: (data: ProjectReadPreviewInput) => void,
): Promise<ProjectReadPreviewInput | null> {
  const response = await hostClient.request({
    type: 'project/read-file',
    projectPath,
    relativePath,
  });
  if (!response.success || !response.data) return null;
  const head = response.data as ProjectReadPreviewInput & {
    previewChunkBytes?: number;
    previewThumbDataUrl?: string;
  };
  const placeholder: ProjectReadPreviewInput | null =
    !head.previewDataUrl && head.previewChunkBytes && head.previewThumbDataUrl
      ? { ...head, previewDataUrl: head.previewThumbDataUrl }
      : null;
  if (placeholder) onPlaceholder?.(placeholder);
  try {
    const full = await completeProjectImagePreview({
      data: head,
      projectPath,
      relativePath,
      request: (command) => hostClient.request(command),
    });
    if (placeholder && full.previewDataUrl) await predecodeImage(full.previewDataUrl);
    return full;
  } catch (error) {
    console.warn('[active-document] Unable to assemble image preview.', error);
    // A painted placeholder beats falling through to "not found".
    return placeholder;
  }
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Read the requested path, and when that misses, the one the Host resolves.
 *
 * `onPlaceholder` fires for painted-first thumbnails only, so a slow
 * full-resolution assembly never blocks the viewer.
 */
export async function readProjectPreviewWithFallback(input: {
  hostClient: HostClient;
  projectPath: string;
  relativePath: string;
  onPlaceholder?: (data: ProjectReadPreviewInput) => void;
}): Promise<ProjectPreviewOpenResult> {
  const direct = await readProjectPreviewData(
    input.hostClient,
    input.projectPath,
    input.relativePath,
    input.onPlaceholder,
  );
  if (direct) {
    return { kind: 'read', data: direct };
  }

  const resolution = await resolveProjectFilePath({
    request: (command) => input.hostClient.request(command),
    projectPath: input.projectPath,
    query: input.relativePath,
  });
  if (resolution.kind === 'ambiguous') {
    return { kind: 'ambiguous', relativePaths: resolution.relativePaths };
  }
  if (resolution.kind === 'missing-root') {
    // Saying "file not found" here blames the wrong thing: the whole
    // workspace folder is gone.
    return { kind: 'missing-root' };
  }
  if (resolution.kind !== 'unique') {
    return { kind: 'none' };
  }
  const resolvedRelative = normalizeRelativePath(resolution.relativePath);
  if (!resolvedRelative || resolvedRelative === normalizeRelativePath(input.relativePath)) {
    // The search returned the path that just failed; do not loop.
    return { kind: 'none' };
  }
  const data = await readProjectPreviewData(
    input.hostClient,
    input.projectPath,
    resolvedRelative,
    input.onPlaceholder,
  );
  return data ? { kind: 'read', data, resolvedRelativePath: resolvedRelative } : { kind: 'none' };
}
