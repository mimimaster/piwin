/**
 * preview/read-local-file — local-Host user-gesture file preview
 * (ADR 0052 Slice 4).
 *
 * Raster images are ingested into the session media vault; text is returned
 * inline. Remote host-server rejects this command; only the local sidecar
 * JSONL transport may invoke it.
 */
import type { HostCommand, HostResponse, LocalFilePreviewData } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { loadPiwinConfig } from '../config-store.js';
import { previewLocalFile } from '../local-file-preview.js';
import { getPiwinMediaDir, getPiwinRoot } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>(['preview/read-local-file']);

export function isMediaIngestCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handleMediaIngestCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!isMediaIngestCommand(command) || command.type !== 'preview/read-local-file') {
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
