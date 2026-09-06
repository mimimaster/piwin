/**
 * Save/download original Artifact source (never wrapped srcdoc or theme-repaired
 * renderSource). Browser/Tauri offer a file; File System Access is used when
 * the shell exposes it so "Save" can pick a location.
 */

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

function triggerBlobDownload(blob: Blob, fileName: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = 'noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
}

type SaveFilePicker = (options: {
  suggestedName?: string;
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

async function saveBlobWithPicker(blob: Blob, fileName: string): Promise<'saved' | 'cancelled'> {
  const picker = (globalThis as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker !== 'function') {
    triggerBlobDownload(blob, fileName);
    return 'saved';
  }
  try {
    const handle = await picker({ suggestedName: fileName });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return 'saved';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return 'cancelled';
    }
    triggerBlobDownload(blob, fileName);
    return 'saved';
  }
}

/** Offer a UTF-8 text file through the save picker, with blob download fallback. */
export function downloadTextFile(input: {
  text: string;
  fileName: string;
  mimeType?: string;
}): void {
  const blob = new Blob([input.text], {
    type: input.mimeType ?? 'text/plain;charset=utf-8',
  });
  void saveBlobWithPicker(blob, input.fileName);
}

/** Offer original model source as an HTML/SVG file. */
export function downloadArtifactSource(input: {
  source: string;
  title: string;
  kind: ArtifactExportKind;
}): void {
  downloadTextFile({
    text: input.source,
    fileName: artifactExportFileName(input.title, input.kind),
    mimeType: artifactExportMimeType(input.kind),
  });
}
