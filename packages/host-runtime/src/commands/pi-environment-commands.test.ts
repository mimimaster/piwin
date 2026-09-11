import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handlePiEnvironmentCommand } from './pi-environment-commands.js';
import type { HostCommandContext } from './host-command-context.js';

function context(piwinRoot: string): HostCommandContext {
  return {
    piwinRoot,
    push: () => undefined,
    requireSession: () => {
      throw new Error('unused');
    },
    getMcpManager: () => {
      throw new Error('unused');
    },
    getJobController: () => {
      throw new Error('unused');
    },
    todoStore: {} as HostCommandContext['todoStore'],
    petStateStore: {} as HostCommandContext['petStateStore'],
    runCronJob: async () => ({ ok: true }),
    pendingPermissions: new Map(),
    pendingExtensionUi: new Map(),
    rememberProjectPermission: async () => undefined,
    rememberSessionPermission: () => undefined,
    sessionPermissionOverrides: new Map(),
    setSessionPermissionOverride: () => undefined,
    clearSessionPermissionOverride: () => undefined,
  };
}

describe('pi-environment commands', () => {
  it('skips detect and apply when PIWIN_ROOT is not the default product root', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-cmd-custom-'));
    const previous = process.env.PI_CODING_AGENT_DIR;
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-cli-cmd-'));
    await writeFile(join(agentDir, 'auth.json'), '{"xai":{"type":"oauth"}}', 'utf8');
    process.env.PI_CODING_AGENT_DIR = agentDir;
    try {
      const detect = await handlePiEnvironmentCommand(
        { type: 'pi-environment/detect' },
        'd1',
        context(piwinRoot),
      );
      expect(detect?.success).toBe(true);
      expect(detect && detect.success ? detect.data : undefined).toMatchObject({
        available: false,
        reason: 'non-default-root',
      });
      const apply = await handlePiEnvironmentCommand(
        { type: 'pi-environment/apply' },
        'r1',
        context(piwinRoot),
      );
      expect(apply?.success).toBe(true);
      expect(apply && apply.success ? apply.data : undefined).toMatchObject({
        ok: false,
        skipped: true,
        reason: 'non-default-root',
      });
      await expect(readFile(join(piwinRoot, 'pi-agent', 'auth.json'), 'utf8')).rejects.toThrow();
    } finally {
      if (previous === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previous;
      }
    }
  });
});
