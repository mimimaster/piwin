import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createExtensionRevisionStore } from './extension-revision-store.js';

describe('ExtensionRevisionStore', () => {
  it('stages an immutable file revision without enabling it', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-extension-store-'));
    const sourceDir = await mkdtemp(join(tmpdir(), 'piwin-extension-source-'));
    const sourcePath = join(sourceDir, 'hello.ts');
    await writeFile(sourcePath, '/** hello */\nexport default function () {}\n', 'utf8');

    const store = createExtensionRevisionStore(rootDir);
    const staged = await store.stage({ sourcePath });

    expect(staged.extensionId).toBe('hello');
    expect(staged.contentRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(staged.targetPath).toContain(join('extensions', 'revisions', 'hello'));
    expect(await readFile(staged.targetPath, 'utf8')).toContain('export default');
    expect((await store.getRecord('hello'))?.configuredEnabled).toBe(false);
    expect(await store.listActiveRevisionRefs()).toEqual([]);
    expect((await stat(join(rootDir, 'extensions', 'registry.json'))).isFile()).toBe(true);
  });

  it('keeps old revisions when source content changes and enables the selected revision', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-extension-store-update-'));
    const sourceDir = await mkdtemp(join(tmpdir(), 'piwin-extension-source-update-'));
    const sourcePath = join(sourceDir, 'hello.ts');
    await writeFile(sourcePath, 'export default function () { return 1; }\n', 'utf8');

    const store = createExtensionRevisionStore(rootDir);
    const first = await store.stage({ sourcePath });
    await writeFile(sourcePath, 'export default function () { return 2; }\n', 'utf8');
    const second = await store.stage({ sourcePath });

    expect(second.contentRevision).not.toBe(first.contentRevision);
    const record = await store.getRecord('hello');
    expect(record?.revisions).toHaveLength(2);
    expect(record?.selectedRevision).toBe(first.contentRevision);

    await store.selectRevision('hello', second.contentRevision);
    const enabled = await store.setEnabled('hello', true);
    expect(enabled.extensions.hello?.configuredEnabled).toBe(true);
    expect(await store.listActiveRevisionRefs()).toEqual([
      {
        extensionId: 'hello',
        contentRevision: second.contentRevision,
        entryPath: second.targetPath,
      },
    ]);
  });

  it('rejects symbolic links inside an extension source tree', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-extension-store-link-'));
    const sourceDir = await mkdtemp(join(tmpdir(), 'piwin-extension-source-link-'));
    await writeFile(join(sourceDir, 'index.ts'), 'export default function () {}\n', 'utf8');
    await symlink(join(sourceDir, 'index.ts'), join(sourceDir, 'nested.ts'));
    await expect(
      createExtensionRevisionStore(rootDir).stage({ sourcePath: sourceDir }),
    ).rejects.toThrow('symbolic links');
  });

  it('round-trips a superseded deployment record', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-extension-store-superseded-'));
    const store = createExtensionRevisionStore(rootDir);
    const now = new Date().toISOString();
    const record = {
      deploymentId: 'deploy-superseded',
      sessionId: 'session-1',
      targetRegistryRevision: 'rev-old',
      when: 'after-current-run' as const,
      phase: 'superseded' as const,
      error: 'target registry revision is no longer current',
      createdAt: now,
      updatedAt: now,
    };

    await store.writeDeployment(record);
    expect(await store.readDeployment('deploy-superseded')).toEqual(record);
  });

  it('rejects an unknown deployment phase', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-extension-store-unknown-phase-'));
    const store = createExtensionRevisionStore(rootDir);
    const now = new Date().toISOString();
    await mkdir(join(rootDir, 'extensions', 'deployments'), { recursive: true });
    await writeFile(
      join(rootDir, 'extensions', 'deployments', 'deploy-unknown.json'),
      `${JSON.stringify({
        deploymentId: 'deploy-unknown',
        sessionId: 'session-1',
        targetRegistryRevision: 'rev-1',
        when: 'now',
        phase: 'time-travel',
        createdAt: now,
        updatedAt: now,
      })}\n`,
      'utf8',
    );

    await expect(store.readDeployment('deploy-unknown')).rejects.toThrow(
      'Invalid extension deployment record',
    );
  });
  it('keeps a pending-removal extension until no runtime references its revision', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-extension-store-remove-'));
    const sourceDir = await mkdtemp(join(tmpdir(), 'piwin-extension-source-remove-'));
    const sourcePath = join(sourceDir, 'hello.ts');
    await writeFile(sourcePath, 'export default function () {}\n', 'utf8');
    const store = createExtensionRevisionStore(rootDir);
    const staged = await store.stage({ sourcePath });
    await store.setEnabled('hello', true);

    await store.markPendingRemoval('hello');
    const pending = await store.getRecord('hello');
    expect(pending?.installationState).toBe('pending-removal');
    expect(pending?.configuredEnabled).toBe(false);
    expect(await store.listActiveRevisionRefs()).toEqual([]);
    await expect(store.setEnabled('hello', true)).rejects.toThrow(/being removed/);

    expect(await store.purgeRemoved(new Set([staged.contentRevision]))).toEqual([]);
    expect(await store.getRecord('hello')).toBeDefined();
    expect((await stat(staged.targetPath)).isFile()).toBe(true);

    expect(await store.purgeRemoved(new Set())).toEqual(['hello']);
    expect(await store.getRecord('hello')).toBeUndefined();
    await expect(stat(join(rootDir, 'extensions', 'revisions', 'hello'))).rejects.toThrow();
  });

  it('clears pending removal when the same extension is installed again', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-extension-store-reinstall-'));
    const sourceDir = await mkdtemp(join(tmpdir(), 'piwin-extension-source-reinstall-'));
    const sourcePath = join(sourceDir, 'hello.ts');
    await writeFile(sourcePath, 'export default function () {}\n', 'utf8');
    const store = createExtensionRevisionStore(rootDir);
    await store.stage({ sourcePath });
    await store.markPendingRemoval('hello');

    await store.stage({ sourcePath });

    expect((await store.getRecord('hello'))?.installationState).toBeUndefined();
  });
});
