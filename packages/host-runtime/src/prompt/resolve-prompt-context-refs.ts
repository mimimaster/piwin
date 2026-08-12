/**
 * Resolve PromptContextRef[] into model-facing labeled blocks.
 *
 * Used by session/prompt preparation (SIDE handoff + CM context menus).
 * The UI never reads project files; Host path-jails and size-bounds all FS refs.
 */

import type { PromptContextRef, SessionTranscriptMessage } from '@piwin/contracts';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { resolve as resolvePath, sep } from 'node:path';

export const MAX_CONTEXT_REF_FILE_BYTES = 32 * 1024;
export const MAX_CONTEXT_REF_TEXT_CHARS = 8000;
export const MAX_CONTEXT_REF_FOLDER_ENTRIES = 200;

const IGNORED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.pnpm-store',
  'dist',
  'target',
  '.next',
  'coverage',
]);

export type ResolvePromptContextRefsDeps = {
  loadTranscriptMessages: (sessionId: string) => Promise<SessionTranscriptMessage[]>;
  loadTranscriptMessage?: (
    sessionId: string,
    messageId: string,
  ) => Promise<SessionTranscriptMessage | undefined>;
  isRegisteredProjectRoot?: (projectPath: string) => Promise<boolean>;
  onDiagnostic?: (message: string) => void;
};

export function selectFileReferenceRange(
  content: string,
  lineStart?: number,
  lineEnd?: number,
): string | undefined {
  if (lineStart === undefined) return content;
  if (!Number.isSafeInteger(lineStart) || lineStart < 1) return undefined;
  const effectiveEnd =
    lineEnd === undefined
      ? lineStart
      : !Number.isSafeInteger(lineEnd) || lineEnd < lineStart
        ? undefined
        : lineEnd;
  if (effectiveEnd === undefined) return undefined;
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lineStart > lines.length) return undefined;
  return lines.slice(lineStart - 1, Math.min(effectiveEnd, lines.length)).join('\n');
}

async function loadReferencedMessage(
  deps: ResolvePromptContextRefsDeps,
  sessionId: string,
  messageId: string,
): Promise<SessionTranscriptMessage | undefined> {
  if (deps.loadTranscriptMessage) {
    return deps.loadTranscriptMessage(sessionId, messageId);
  }
  const messages = await deps.loadTranscriptMessages(sessionId);
  return messages.find((item) => item.id === messageId);
}

/**
 * Resolve structured context refs into a bounded, labeled context block for the
 * model prompt. The user transcript keeps the original text + refs; this only
 * shapes model-facing text.
 */
export async function resolvePromptContextRefs(
  deps: ResolvePromptContextRefsDeps,
  refs: PromptContextRef[],
): Promise<string> {
  const blocks: string[] = [];
  for (const ref of refs) {
    switch (ref.kind) {
      case 'side-chat-message': {
        const message = await loadReferencedMessage(deps, ref.sideChatSessionId, ref.messageId);
        if (message) {
          blocks.push(
            `[side-chat-reference: ${ref.label}]\n${message.text.trim().slice(0, MAX_CONTEXT_REF_TEXT_CHARS)}`,
          );
        } else {
          deps.onDiagnostic?.(
            `context ref missing: kind=side-chat-message session=${ref.sideChatSessionId} message=${ref.messageId}`,
          );
        }
        break;
      }
      case 'main-message': {
        const message = await loadReferencedMessage(deps, ref.sourceSessionId, ref.messageId);
        if (message) {
          blocks.push(
            `[main-message-reference: ${ref.label}]\n${message.text.trim().slice(0, MAX_CONTEXT_REF_TEXT_CHARS)}`,
          );
        } else {
          deps.onDiagnostic?.(
            `context ref missing: kind=main-message session=${ref.sourceSessionId} message=${ref.messageId}`,
          );
        }
        break;
      }
      case 'file': {
        if (
          deps.isRegisteredProjectRoot &&
          !(await deps.isRegisteredProjectRoot(ref.projectPath))
        ) {
          break;
        }
        const content = await readBoundedFileForRef(ref.projectPath, ref.relativePath);
        if (content !== undefined) {
          const selected = selectFileReferenceRange(content, ref.lineStart, ref.lineEnd);
          if (selected === undefined) {
            deps.onDiagnostic?.(
              `context ref range invalid: kind=file path=${ref.relativePath} start=${ref.lineStart ?? ''} end=${ref.lineEnd ?? ''}`,
            );
            break;
          }
          const range =
            ref.lineStart !== undefined
              ? `:${ref.lineStart}${ref.lineEnd !== undefined ? `-${ref.lineEnd}` : ''}`
              : '';
          blocks.push(`[file-reference: ${ref.relativePath}${range}]\n${selected}`);
        }
        break;
      }
      case 'folder': {
        if (
          deps.isRegisteredProjectRoot &&
          !(await deps.isRegisteredProjectRoot(ref.projectPath))
        ) {
          break;
        }
        const listing = await listBoundedFolderForRef(ref.projectPath, ref.relativePath);
        if (listing !== undefined) {
          const folderLabel = ref.relativePath === '' ? '.' : ref.relativePath;
          blocks.push(`[folder-reference: ${folderLabel}]\n${listing}`);
        }
        break;
      }
      case 'selection': {
        const body = ref.snapshotText.slice(0, MAX_CONTEXT_REF_TEXT_CHARS);
        const loc =
          ref.relativePath != null
            ? `${ref.relativePath}${
                ref.lineStart != null
                  ? `:${ref.lineStart}${ref.lineEnd != null ? `-${ref.lineEnd}` : ''}`
                  : ''
              }`
            : ref.label;
        blocks.push(`[selection-reference: ${loc}]\n${body}`);
        break;
      }
      case 'diff':
        blocks.push(
          `[diff-reference: ${ref.label}]\n${ref.snapshotText.slice(0, MAX_CONTEXT_REF_TEXT_CHARS)}`,
        );
        break;
      case 'terminal-output':
        blocks.push(
          `[terminal-output-reference: ${ref.label}]\n${ref.snapshotText.slice(0, MAX_CONTEXT_REF_TEXT_CHARS)}`,
        );
        break;
      case 'error':
        blocks.push(
          `[error-reference: ${ref.title}]\n${ref.detail.slice(0, MAX_CONTEXT_REF_TEXT_CHARS)}`,
        );
        break;
      default:
        break;
    }
  }
  return blocks.join('\n\n');
}

/** Read a path-validated file under a project root, bounded and text-only. */
export async function readBoundedFileForRef(
  projectPath: string,
  relativePath: string,
  isRegisteredProjectRoot?: (projectPath: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (isRegisteredProjectRoot && !(await isRegisteredProjectRoot(projectPath))) {
    return undefined;
  }
  const rooted = await resolvePathInsideProjectRoot(projectPath, relativePath);
  if (!rooted) {
    return undefined;
  }
  let fileStats;
  try {
    fileStats = await stat(rooted.realCandidate);
  } catch {
    return undefined;
  }
  if (!fileStats.isFile() || fileStats.size > MAX_CONTEXT_REF_FILE_BYTES) {
    return undefined;
  }
  try {
    const buffer = await readFile(rooted.realCandidate);
    if (buffer.subarray(0, 8000).includes(0)) {
      return undefined; // binary — never inject into the prompt
    }
    return buffer.toString('utf8').slice(0, MAX_CONTEXT_REF_FILE_BYTES);
  } catch {
    return undefined;
  }
}

/**
 * List one directory level under project root (names only).
 * Directories are marked with a trailing `/`. Caps at MAX_CONTEXT_REF_FOLDER_ENTRIES.
 */
export async function listBoundedFolderForRef(
  projectPath: string,
  relativePath: string,
  isRegisteredProjectRoot?: (projectPath: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (isRegisteredProjectRoot && !(await isRegisteredProjectRoot(projectPath))) {
    return undefined;
  }
  const rooted = await resolvePathInsideProjectRoot(projectPath, relativePath);
  if (!rooted) {
    return undefined;
  }
  let fileStats;
  try {
    fileStats = await stat(rooted.realCandidate);
  } catch {
    return undefined;
  }
  if (!fileStats.isDirectory()) {
    return undefined;
  }

  let directoryEntries;
  try {
    directoryEntries = await readdir(rooted.realCandidate, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const names: string[] = [];
  for (const dirent of directoryEntries) {
    if (
      dirent.name.startsWith('.') &&
      dirent.name !== '.gitignore' &&
      dirent.name !== '.env.example'
    ) {
      continue;
    }
    if (dirent.isDirectory() && IGNORED_DIR_NAMES.has(dirent.name)) {
      continue;
    }
    names.push(dirent.isDirectory() ? `${dirent.name}/` : dirent.name);
    if (names.length >= MAX_CONTEXT_REF_FOLDER_ENTRIES) {
      break;
    }
  }
  names.sort((left, right) => left.localeCompare(right));
  const truncated = directoryEntries.length > names.length;
  const header = truncated
    ? `entries (${names.length}+, capped at ${MAX_CONTEXT_REF_FOLDER_ENTRIES}):`
    : `entries (${names.length}):`;
  if (names.length === 0) {
    return `${header}\n(empty)`;
  }
  return `${header}\n${names.map((name) => `- ${name}`).join('\n')}`;
}

async function resolvePathInsideProjectRoot(
  projectPath: string,
  relativePath: string,
): Promise<{ realRoot: string; realCandidate: string } | undefined> {
  const rootAbsolute = resolvePath(projectPath);
  const relativeNormalized = relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const candidate =
    relativeNormalized.length === 0 ? rootAbsolute : resolvePath(rootAbsolute, relativeNormalized);
  let realCandidate: string;
  let realRoot: string;
  try {
    [realCandidate, realRoot] = await Promise.all([realpath(candidate), realpath(rootAbsolute)]);
  } catch {
    return undefined;
  }
  if (!realCandidate.startsWith(`${realRoot}${sep}`) && realCandidate !== realRoot) {
    return undefined;
  }
  return { realRoot, realCandidate };
}
