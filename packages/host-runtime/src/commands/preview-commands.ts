/**
 * preview/read-trusted-text — config-root read-only text (ADR 0052 Slice 3).
 *
 * Kept out of catalog-commands so that file stays under the line cap and the
 * new read domain has its own authority surface.
 */
import type { HostCommand, HostResponse, TrustedTextReadData } from '@piwin/contracts';
import { getPiwinRoot } from '../paths.js';
import { ok } from '../response-helpers.js';
import { readTrustedConfigText } from '../trusted-text-reader.js';

const TYPES = new Set<HostCommand['type']>(['preview/read-trusted-text']);

export function isPreviewCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handlePreviewCommand(
  command: HostCommand,
  requestId: string | undefined,
  piwinRoot: string | undefined,
): Promise<HostResponse | null> {
  if (!isPreviewCommand(command)) {
    return null;
  }

  switch (command.type) {
    case 'preview/read-trusted-text': {
      const data: TrustedTextReadData = await readTrustedConfigText({
        piwinRoot: getPiwinRoot(piwinRoot),
        relativePath: command.input.relativePath,
        ...(command.input.maxBytes !== undefined ? { maxBytes: command.input.maxBytes } : {}),
      });
      return ok(requestId, 'preview/read-trusted-text', data);
    }
    default:
      return null;
  }
}
