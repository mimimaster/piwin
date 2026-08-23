/**
 * Local-Host user-gesture preview / export commands (ADR 0052 Slice 4 + Save As).
 *
 * - preview/read-local-file: raster → media vault; text inline
 * - preview/export-local-file: whole-file base64 for Desktop Save As
 *
 * Remote host-server rejects both; only the local sidecar JSONL transport
 * may invoke them.
 */
import type {
  HostCommand,
  HostResponse,
  LocalFileExportData,
  LocalFilePreviewData,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { loadPiwinConfig } from '../config-store.js';
import { exportLocalFile } from '../local-file-export.js';
import { previewLocalFile } from '../local-file-preview.js';
import { getPiwinMediaDir, getPiwinRoot } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>([
  'preview/read-local-file',
  'preview/export-local-file',
]);

export function isMediaIngestCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleMediaIngestCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!isMediaIngestCommand(command)) {
    return null;
  }

  if (command.type === 'preview/export-local-file') {
    try {
      const data: LocalFileExportData = await exportLocalFile({
        absolutePath: command.input.absolutePath,
        ...(command.input.maxBytes !== undefined ? { maxBytes: command.input.maxBytes } : {}),
      });
      return ok(requestId, 'preview/export-local-file', data);
    } catch (error) {
      return fail(requestId, 'preview/export-local-file', formatError(error));
    }
  }

  if (command.type !== 'preview/read-local-file') {
    return null;
  }

  try {
    if (context.requireDurableSession) {
      await context.requireDurableSession(command.input.sessionId);
    } else {
      context.requireSession(command.input.sessionId);
    }
  } catch (error) {
    return fail(requestId, 'preview/read-local-file', formatError(error));
  }

  const rootDir = getPiwinRoot(context.piwinRoot);
  const config = await loadPiwinConfig(rootDir);
  const data: LocalFilePreviewData = await previewLocalFile({
    absolutePath: command.input.absolutePath,
    sessionId: command.input.sessionId,
    mediaRoot: getPiwinMediaDir(rootDir),
    maxImageBytes: config.media.maxPasteBytes,
    allowedMimeTypes: config.media.allowedMimeTypes,
  });
  return ok(requestId, 'preview/read-local-file', data);
}
