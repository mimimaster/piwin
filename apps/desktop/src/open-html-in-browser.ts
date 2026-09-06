/**
 * Route real HTML files into the workbench Browser tab instead of Doc Preview.
 *
 * Bare chips such as `.html` / `card.html` stay on the document path so
 * transcript recovery still works. File-tree and tool-card clicks pass an
 * absolute path (or a project-file target) and therefore open in Chromium.
 */
import { isBareExtensionPath } from './document-open-path';
import { resolveLocalFileAbsolutePath } from './local-file-actions.js';
import type { RightPanelTab } from './right-panel';
import type { DocumentOpenInput } from './tool-call-card';

const HTML_FILE_EXTENSION_RE = /\.html?$/i;

function stripQueryAndHash(path: string): string {
  const match = /^[^?#]*/.exec(path);
  return match?.[0] ?? path;
}

function looksLikeAbsoluteFilesystemPath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Encode a POSIX-style pathname for a `file:` URL without touching drive
 * letters (`C:`) or slash separators.
 */
function encodeFilePathname(pathname: string): string {
  return pathname
    .split('/')
    .map((segment, index) => {
      if (index === 1 && /^[A-Za-z]:$/.test(segment)) {
        return segment;
      }
      return encodeURIComponent(segment);
    })
    .join('/');
}

export function isHtmlFilePath(path: string): boolean {
  const clean = stripQueryAndHash(path.replace(/^file:\/\//i, '').trim());
  return HTML_FILE_EXTENSION_RE.test(clean);
}

/**
 * True when this path should open in the workbench browser rather than Doc
 * Preview. Bare filenames stay false unless `allowBareFilename` (file tree /
 * project-file target).
 */
export function shouldOpenHtmlInWorkbenchBrowser(
  path: string,
  options?: { allowBareFilename?: boolean },
): boolean {
  const clean = stripQueryAndHash(path.replace(/^file:\/\//i, '').trim());
  if (!clean || isBareExtensionPath(clean) || !HTML_FILE_EXTENSION_RE.test(clean)) {
    return false;
  }
  if (options?.allowBareFilename === true) {
    return true;
  }
  return (
    clean.includes('/') || clean.includes('\\') || /^[A-Za-z]:/.test(clean)
  );
}

export function fileUrlFromAbsolutePath(absolutePath: string): string {
  const stripped = absolutePath.replace(/^file:\/\//i, '').trim().replace(/\\/g, '/');
  const pathname = /^[A-Za-z]:\//.test(stripped)
    ? `/${stripped}`
    : stripped.startsWith('/')
      ? stripped
      : `/${stripped}`;
  return `file://${encodeFilePathname(pathname)}`;
}

export function resolveHtmlWorkbenchBrowserUrl(input: {
  path: string;
  projectPath?: string | null;
  allowBareFilename?: boolean;
}): string | null {
  const allowBareFilename = input.allowBareFilename === true;
  if (!shouldOpenHtmlInWorkbenchBrowser(input.path, { allowBareFilename })) {
    return null;
  }
  const absolute = resolveLocalFileAbsolutePath(input.path, input.projectPath);
  if (!looksLikeAbsoluteFilesystemPath(absolute)) {
    return null;
  }
  return fileUrlFromAbsolutePath(absolute);
}

function htmlPathFromDocumentOpen(doc: DocumentOpenInput): {
  path: string;
  allowBareFilename: boolean;
} | null {
  if (doc.content !== undefined) {
    return null;
  }
  if (doc.target) {
    if (doc.target.kind !== 'project-file') {
      return null;
    }
    return { path: doc.target.relativePath, allowBareFilename: true };
  }
  return { path: doc.path ?? '', allowBareFilename: false };
}

/**
 * When this is a real HTML file, switch the inspector to Browser and navigate.
 * Returns true when the document-open path should stop.
 */
export function tryOpenHtmlDocumentInBrowser(input: {
  doc: DocumentOpenInput;
  projectPath?: string | null;
  canNavigate: boolean;
  openInspector: (tab: RightPanelTab) => void;
  navigate: (url: string) => void;
}): boolean {
  if (!input.canNavigate) {
    return false;
  }
  const resolved = htmlPathFromDocumentOpen(input.doc);
  if (!resolved) {
    return false;
  }
  const url = resolveHtmlWorkbenchBrowserUrl({
    path: resolved.path,
    allowBareFilename: resolved.allowBareFilename,
    ...(input.projectPath !== undefined ? { projectPath: input.projectPath } : {}),
  });
  if (!url) {
    return false;
  }
  input.openInspector('browser');
  input.navigate(url);
  return true;
}
