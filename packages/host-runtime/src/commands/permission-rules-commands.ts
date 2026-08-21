/**
 * Operator shell reads/writes Host-owned `~/.piwin/permissions.json`.
 */
import { createHash } from 'node:crypto';
import type { HostCommand, HostResponse, PermissionRulesFile } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import {
  readUserPermissionRulesFile,
  writeUserPermissionRulesFile,
} from '../permission-rule-loader.js';
import { fail, ok } from '../response-helpers.js';
import { getPiwinRoot } from '../paths.js';
import type { HostCommandContext } from './host-command-context.js';

const TYPES = new Set<HostCommand['type']>(['permissions/get-rules', 'permissions/set-rules']);

export function permissionRulesRevision(rules: PermissionRulesFile): string {
  return createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 12);
}

export function isPermissionRulesCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

export async function handlePermissionRulesCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: HostCommandContext,
): Promise<HostResponse | null> {
  if (!isPermissionRulesCommand(command)) {
    return null;
  }
  const piwinRoot = getPiwinRoot(context.piwinRoot);
  try {
    if (command.type === 'permissions/get-rules') {
      if (command.layer !== 'user') {
        return fail(requestId, 'permissions/get-rules', 'Only the Host user-global rules file is writable here');
      }
      const rules = await readUserPermissionRulesFile(piwinRoot);
      return ok(requestId, 'permissions/get-rules', {
        layer: 'user',
        rules,
        revision: permissionRulesRevision(rules),
      });
    }
    if (command.type !== 'permissions/set-rules') {
      return null;
    }
    if (command.layer !== 'user') {
      return fail(requestId, 'permissions/set-rules', 'Only the Host user-global rules file is writable here');
    }
    const current = await readUserPermissionRulesFile(piwinRoot);
    const currentRevision = permissionRulesRevision(current);
    if (
      command.expectedRevision !== undefined &&
      command.expectedRevision !== currentRevision
    ) {
      return fail(
        requestId,
        'permissions/set-rules',
        `Rules file changed on the Host (expected ${command.expectedRevision}, have ${currentRevision})`,
      );
    }
    await writeUserPermissionRulesFile(piwinRoot, command.rules);
    const rules = await readUserPermissionRulesFile(piwinRoot);
    return ok(requestId, 'permissions/set-rules', {
      layer: 'user',
      rules,
      revision: permissionRulesRevision(rules),
    });
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}
