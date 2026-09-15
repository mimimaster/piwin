/**
 * Save original Artifact source (never wrapped srcdoc or theme-repaired
 * renderSource). Reuses PathChip Save As: native dialog on Desktop, File
 * System Access / blob download in the browser preview.
 */

import { saveBlobAs, type SaveLocalFileAsResult } from './local-file-actions.js';

export type ArtifactExportKind = 'html' | 'svg';

const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function artifactExportFileName(title: string, kind: ArtifactExportKind): string {
  const extension = kind === 'svg' ? 'svg' : 'html';
  const stem = title
    .trim()
    .replace(INVALID_FILE_NAME_CHARS, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  const safeStem = stem.length > 0 ? stem : 'artifact';
  if (safeStem.toLowerCase().endsWith(`.${extension}`)) {
    return safeStem;
  }
  return `${safeStem}.${extension}`;
}

export function artifactExportMimeType(kind: ArtifactExportKind): string {
  return kind === 'svg' ? 'image/svg+xml;charset=utf-8' : 'text/html;charset=utf-8';
}

export function artifactDownloadLabel(
  locale: 'zh-CN' | 'en',
  kind: ArtifactExportKind,
): string {
  if (locale === 'zh-CN') {
    return kind === 'svg' ? '下载 SVG' : '下载 HTML';
  }
  return kind === 'svg' ? 'Download SVG' : 'Download HTML';
}

/** Offer a UTF-8 text file through the shared Save As path. */
export function downloadTextFile(input: {
  text: string;
  fileName: string;
  mimeType?: string;
}): Promise<SaveLocalFileAsResult> {
  const blob = new Blob([input.text], {
    type: input.mimeType ?? 'text/plain;charset=utf-8',
  });
  return saveBlobAs(blob, input.fileName);
}

/** Offer original model source as an HTML/SVG file. */
export function downloadArtifactSource(input: {
  source: string;
  title: string;
  kind: ArtifactExportKind;
}): Promise<SaveLocalFileAsResult> {
  return downloadTextFile({
    text: input.source,
    fileName: artifactExportFileName(input.title, input.kind),
    mimeType: artifactExportMimeType(input.kind),
  });
}
