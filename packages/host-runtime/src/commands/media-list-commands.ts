/**
 * media/list + media/delete — vault catalog for the unified Studio Library.
 * List is metadata only; delete removes the vault file and optional sidecar.
 */
import type { HostCommand, HostResponse, MediaDeleteData, MediaListData } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { deleteMediaAsset, listMediaLibrary } from '@piwin/media';
import { getPiwinMediaDir, getPiwinRoot } from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import type { HostCommandContext } from './host-command-context.js';

export function isMediaListCommand(command: HostCommand): boolean {
  return command.type === 'media/list' || command.type === 'media/delete';
}

export async function handleMediaListCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (command.type !== 'media/list' && command.type !== 'media/delete') {
    return null;
  }
  try {
    const rootDir = getPiwinRoot(context.piwinRoot);
    const mediaRoot = getPiwinMediaDir(rootDir);
    if (command.type === 'media/delete') {
      const deleted = await deleteMediaAsset({ mediaRoot }, command.input);
      const data: MediaDeleteData = {
        deleted,
        sessionId: command.input.sessionId,
        assetId: command.input.assetId,
      };
      return ok(requestId, 'media/delete', data);
    }
    const data: MediaListData = await listMediaLibrary({ mediaRoot }, command.input);
    return ok(requestId, 'media/list', data);
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}
