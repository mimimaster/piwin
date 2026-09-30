/**
 * While an undo/redo sits at `needs-repair`, its files hold half of an
 * operation. New Host writes on top would make the repair unable to tell what
 * belongs to whom, so file tools refuse those exact paths and repo-wide
 * operations (git checkout, subagent integration) refuse the workspace until
 * the repair verifies. Ordinary shell commands are not blocked (tests must
 * still run); the repair's per-path checks never overwrite foreign content.
 *
 * State comes from the durable operation log on every call, so the block
 * survives Host restarts and lifts the moment the repair verifies.
 */
import { resolve, sep } from 'node:path';

import type { TurnChangeStuckOperation } from '@piwin/git';

import { normalizeWorkspaceRoot, workspaceRootsOverlap } from './workspace-root.js';

export type RepairGuardPort = {
  listStuckOperations(): TurnChangeStuckOperation[];
};

export type RepairBlock = { operationId: string; relativePath?: string };

export const REPAIR_BLOCK_CODE = 'turn-change-needs-repair';

/** A stuck operation that wrote `absolutePath`, if any. */
export function findRepairBlockForPath(
  port: RepairGuardPort | undefined,
  absolutePath: string,
): RepairBlock | undefined {
  if (!port) return undefined;
  const target = resolve(absolutePath);
  for (const stuck of safeList(port)) {
    const root = resolve(stuck.rootPath);
    if (target !== root && !target.startsWith(root + sep)) continue;
    for (const relativePath of stuck.relativePaths) {
      if (resolve(root, relativePath) === target) {
        return { operationId: stuck.operationId, relativePath };
      }
    }
  }
  return undefined;
}

/** A stuck operation anywhere under `rootPath` (for repo-wide operations). */
export function findRepairBlockForWorkspace(
  port: RepairGuardPort | undefined,
  rootPath: string,
): RepairBlock | undefined {
  if (!port) return undefined;
  const root = normalizeWorkspaceRoot(rootPath);
  const stuck = safeList(port).find((entry) =>
    workspaceRootsOverlap(normalizeWorkspaceRoot(entry.rootPath), root),
  );
  return stuck ? { operationId: stuck.operationId } : undefined;
}

export function describeRepairBlock(block: RepairBlock): string {
  const subject = block.relativePath
    ? `${block.relativePath} is part of an undo/redo that stopped halfway`
    : 'an undo/redo in this workspace stopped halfway';
  return `${subject} (operation ${block.operationId}) and needs repair before new writes. Repair it from 代码撤销记录 (Changes → 更多) or \`piwin turn repair ${block.operationId}\`.`;
}

function safeList(port: RepairGuardPort): TurnChangeStuckOperation[] {
  try {
    return port.listStuckOperations();
  } catch (error) {
    // The store being unreadable must not stop every write in the Host.
    console.warn('[turn-changes] repair guard could not read stuck operations', error);
    return [];
  }
}
