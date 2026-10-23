import type { ProjectReadFileData } from '@piwin/contracts';

export type FilePreviewState = {
  relativePath: string;
  absolutePath: string;
  content: string;
  truncated: boolean;
  isBinary: boolean;
  byteSize?: number;
  mimeHint?: string;
  previewDataUrl?: string;
  /**
   * `placeholder`: a downscaled WebP is showing while full-resolution slices
   * load; `placeholder-only`: those slices failed, so it stays.
   */
  previewQuality?: 'placeholder' | 'placeholder-only';
};

export function previewStateFromRead(
  data: ProjectReadFileData,
  relativePath: string,
  absolutePath: string,
): FilePreviewState {
  return {
    relativePath: data.relativePath || relativePath,
    absolutePath: data.absolutePath || absolutePath,
    content: data.content ?? '',
    truncated: data.truncated === true,
    isBinary: data.isBinary === true,
    ...(typeof data.byteSize === 'number' ? { byteSize: data.byteSize } : {}),
    ...(data.mimeHint ? { mimeHint: data.mimeHint } : {}),
    ...(data.previewDataUrl ? { previewDataUrl: data.previewDataUrl } : {}),
  };
}

/** Markdown / plaintext files render through EnhancedMarkdownView (same path as DocPreview). */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'txt', 'text']);

/**
 * Only a missing file reads as "not found"; a transport or permission failure
 * used to wear the same copy and sent users looking for files that exist.
 */
export function previewErrorReason(message: string): string {
  if (/ENOENT|no such file/i.test(message)) return 'not-found';
  if (/not a file/i.test(message)) return 'not-a-file';
  if (/project-root-not-registered/i.test(message)) return 'project-root-not-registered';
  if (/project-root-missing/i.test(message)) return 'project-root-missing';
  return 'unavailable';
}

export function isMarkdownPreviewPath(path: string): boolean {
  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(path);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? '';
  return extension === '' || MARKDOWN_EXTENSIONS.has(extension);
}

