/**
 * In-process exclusive lock per normalized realpath workspace root.
 * Tool, git, integration, and undo share one lock so parent writes cannot overlap.
 */
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export type WorkspaceWriteLease = {
  workspaceId: string;
  release(): void;
};

export type WorkspaceWriteGate = {
  tryAcquire(input: {
    workspaceId: string;
    rootPath: string;
    kind: 'tool' | 'git' | 'integration' | 'undo';
    runId?: string;
  }): Promise<
    | { ok: true; lease: WorkspaceWriteLease }
    | { ok: false; reason: 'workspace-busy' | 'workspace-restoring' | 'foreign-host-active' }
  >;
};

export function normalizeWorkspaceRoot(rootPath: string): string {
  const resolved = resolve(rootPath);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function createWorkspaceWriteGate(): WorkspaceWriteGate {
  const held = new Map<string, string>();
  return {
    tryAcquire(input) {
      const key = normalizeWorkspaceRoot(input.rootPath);
      if (held.has(key)) {
        return Promise.resolve({ ok: false, reason: 'workspace-busy' as const });
      }
      held.set(key, input.workspaceId);
      let released = false;
      return Promise.resolve({
        ok: true as const,
        lease: {
          workspaceId: input.workspaceId,
          release(): void {
            if (released) {
              return;
            }
            released = true;
            held.delete(key);
          },
        },
      });
    },
  };
}
