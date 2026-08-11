import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostCommandContext } from './host-command-context.js';
import { handleCatalogCommand } from './catalog-commands.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function createMinimalContext(rootDir: string): HostCommandContext {
  return {
    piwinRoot: rootDir,
    push: () => {},
    requireSession: () => {
      throw new Error('session not needed for pet import');
    },
    getMcpManager: () => {
      throw new Error('mcp not needed for pet import');
    },
    getJobController: () => {
      throw new Error('jobs not needed for pet import');
    },
    todoStore: {} as HostCommandContext['todoStore'],
    petStateStore: {
      snapshot: () => ({ pet: null }),
      setBase: () => {},
    } as unknown as HostCommandContext['petStateStore'],
    runCronJob: async () => ({ ok: false }),
    pendingPermissions: new Map(),
    pendingExtensionUi: new Map(),
    rememberProjectPermission: async () => {},
    rememberSessionPermission: () => {},
    sessionPermissionOverrides: new Map(),
    setSessionPermissionOverride: () => {},
    clearSessionPermissionOverride: () => {},
  } as unknown as HostCommandContext;
}

async function seedPet(parent: string, petId: string): Promise<string> {
  const packagePath = join(parent, petId);
  await mkdir(packagePath, { recursive: true });
  await writeFile(
    join(packagePath, 'pet.json'),
    JSON.stringify({ id: petId, displayName: petId, spritesheetPath: 'sheet.png' }),
  );
  await writeFile(join(packagePath, 'sheet.png'), PNG_MAGIC);
  return packagePath;
}

describe('pet local import catalog commands', () => {
  it('scans a package directory and imports the selected package', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-pet-command-root-'));
    const sourceRoot = await mkdtemp(join(tmpdir(), 'piwin-pet-command-source-'));
    const packagePath = await seedPet(sourceRoot, 'command-pet');
    const context = createMinimalContext(rootDir);

    const scanResponse = await handleCatalogCommand(
      { type: 'pet/scan-local', sourcePath: sourceRoot },
      'scan-request',
      context,
    );
    expect(scanResponse).toMatchObject({
      command: 'pet/scan-local',
      success: true,
      data: {
        sourcePath: sourceRoot,
        candidates: [{ petId: 'command-pet', valid: true }],
      },
    });

    const installResponse = await handleCatalogCommand(
      { type: 'pet/install-local-batch', sourcePaths: [packagePath] },
      'install-request',
      context,
    );
    expect(installResponse).toMatchObject({
      command: 'pet/install-local-batch',
      success: true,
      data: {
        installed: [{ petId: 'command-pet', source: 'local' }],
        failed: [],
      },
    });
  });
});
