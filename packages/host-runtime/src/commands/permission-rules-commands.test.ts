import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handlePermissionRulesCommand } from './permission-rules-commands.js';
import type { HostCommandContext } from './host-command-context.js';

function context(piwinRoot: string): HostCommandContext {
  return { piwinRoot } as HostCommandContext;
}

describe('permission rules commands', () => {
  it('writes the Host user-global rules file from a shell command', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-rules-cmd-'));
    const empty = await handlePermissionRulesCommand(
      { type: 'permissions/get-rules', layer: 'user' },
      'req-1',
      context(piwinRoot),
    );
    expect(empty?.success).toBe(true);
    if (empty?.success !== true) {
      throw new Error('get-rules failed');
    }
    expect((empty.data as { rules: { version: number } }).rules).toEqual({ version: 1 });

    const written = await handlePermissionRulesCommand(
      {
        type: 'permissions/set-rules',
        layer: 'user',
        rules: {
          version: 1,
          allow: [
            {
              target: { kind: 'bash', pattern: 'git status' },
              decision: 'allow',
              reason: 'read-only git',
            },
          ],
        },
      },
      'req-2',
      context(piwinRoot),
    );
    expect(written?.success).toBe(true);

    const loaded = await handlePermissionRulesCommand(
      { type: 'permissions/get-rules', layer: 'user' },
      'req-3',
      context(piwinRoot),
    );
    expect(loaded?.success).toBe(true);
    if (loaded?.success !== true) {
      throw new Error('reload failed');
    }
    expect(
      (loaded.data as { rules: { allow: Array<{ reason: string }> } }).rules.allow,
    ).toEqual([
      {
        target: { kind: 'bash', pattern: 'git status' },
        decision: 'allow',
        reason: 'read-only git',
      },
    ]);
  });
});
