/**
 * `session/resources`: Host-owned Sources/Outputs projection for Summary.
 * Reads the active-path tail and session vault; never crawls the workspace
 * or message prose.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  formatError,
  mergeGeneratedMediaResources,
  projectSessionResources,
  type HostCommand,
  type HostResponse,
  type SessionResource,
  type SessionResourcesData,
} from '@piwin/contracts';
import { collectSessionResourceMessages } from './collect-session-resource-messages.js';
import { getSessionRecord } from '@piwin/session';
import { listSessionGeneratedMedia } from '../bind-orphan-generated-media.js';
import {
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionMediaDir,
} from '../paths.js';
import { fail, ok } from '../response-helpers.js';
import { rejectUnavailableSessionBody } from '../session-body-guard.js';
import type { SessionProductCommandContext } from './session-product-command-context.js';

export async function handleSessionResourcesCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionProductCommandContext,
): Promise<HostResponse | null> {
  if (command.type !== 'session/resources') return null;
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  try {
    const record = await getSessionRecord(indexPath, command.sessionId);
    if (!record) {
      return fail(requestId, 'session/resources', `Unknown session: ${command.sessionId}`);
    }
    const unavailable = rejectUnavailableSessionBody(
      requestId,
      'session/resources',
      record,
      'resources',
    );
    if (unavailable) return unavailable;
    const messages = await context.withTranscriptStore(command.sessionId, (store) =>
      collectSessionResourceMessages(command.sessionId, store),
    );
    const projected = projectSessionResources(command.sessionId, messages);
    const generated = await listSessionGeneratedMedia(
      getPiwinSessionMediaDir(rootDir, command.sessionId),
    );
    const merged = mergeGeneratedMediaResources(
      command.sessionId,
      projected,
      generated.map((item) => ({ assetId: item.assetId })),
    );
    const workspaceRoot = record.workingDirectory ?? record.projectPath;
    const data: SessionResourcesData = {
      sessionId: command.sessionId,
      resources: await stampFileAvailability(merged, workspaceRoot),
    };
    return ok(requestId, 'session/resources', data);
  } catch (error) {
    return fail(requestId, 'session/resources', formatError(error));
  }
}

async function stampFileAvailability(
  resources: readonly SessionResource[],
  workspaceRoot: string | undefined,
): Promise<SessionResource[]> {
  if (!workspaceRoot || workspaceRoot.trim().length === 0) {
    return [...resources];
  }
  const stamped: SessionResource[] = [];
  for (const resource of resources) {
    if (resource.kind !== 'file' || !resource.target || resource.target.includes('..')) {
      stamped.push(resource);
      continue;
    }
    try {
      await access(join(workspaceRoot, resource.target));
      stamped.push({ ...resource, availability: 'available' });
    } catch {
      stamped.push({ ...resource, availability: 'missing' });
    }
  }
  return stamped;
}
