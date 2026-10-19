import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { ensureBundledExtensionsInstalled } from './ensure-bundled-extensions.js';
import { readSubscriptionExtensionProviders } from './subscription-extension-providers.js';
import { scanExtensions } from './extension-scanner.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'piwin-bundled-provider-')); roots.push(root);
  const bundled = join(root, 'bundled');
  const source = join(bundled, 'public-provider');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'index.ts'), 'export default function () {}\n');
  await writeFile(join(source, 'piwin.json'), JSON.stringify({ modelProvider: {
    id: 'public-provider', name: 'Public Provider', auth: 'none', notice: 'IP availability notice',
  } }));
  const manifest = { name: 'public-provider', version: '0.3.0', piwin: {
    bundledFrom: 'piwin:public-provider', managedId: 'market-public-provider',
  } };
  await writeFile(join(source, 'package.json'), JSON.stringify(manifest));
  return { root, bundled, source, manifest, store: createExtensionRevisionStore(root) };
}

describe('bundled public model provider', () => {
  it('installs an enabled immutable revision once without a second flat copy', async () => {
    const { root, bundled, store } = await fixture();
    expect(await ensureBundledExtensionsInstalled(root, bundled)).toContain('public-provider');
    const record = await store.getRecord('market-public-provider');
    expect(record?.configuredEnabled).toBe(true);
    const [claim] = await readSubscriptionExtensionProviders(root);
    expect(claim).toMatchObject({ kind: 'model', providerId: 'public-provider', bundled: true,
      displayName: 'Public Provider', notice: 'IP availability notice', contentRevision: record?.selectedRevision });
    expect(claim?.entryPath).toContain('/revisions/market-public-provider/');
    await expect(readFile(join(root, 'extensions/public-provider/index.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    const before = await store.readRegistry();
    expect(await ensureBundledExtensionsInstalled(root, bundled)).toEqual([]);
    expect(await store.readRegistry()).toEqual(before);
    expect(await scanExtensions({ piwinRoot: root })).toEqual([
      expect.objectContaining({ id: 'market-public-provider', source: 'bundled', managed: true, enabled: true }),
    ]);
  });

  it.each([true, false])('migrates an existing marketplace install while preserving enabled=%s', async (enabled) => {
    const { root, bundled, source, manifest, store } = await fixture();
    const previous = await store.stage({ sourcePath: source, name: 'market-public-provider', sourceLocator: 'github:owner/provider#old' });
    await store.setEnabled(previous.extensionId, enabled);
    await writeFile(join(source, 'package.json'), JSON.stringify({ ...manifest, version: '0.4.0' }));
    expect(await ensureBundledExtensionsInstalled(root, bundled)).toContain('public-provider');
    const [record] = await store.listRecords();
    expect(record?.configuredEnabled).toBe(enabled);
    expect(record?.selectedRevision).not.toBe(previous.contentRevision);
    expect(record?.revisions).toHaveLength(2);
    expect(await readSubscriptionExtensionProviders(root)).toHaveLength(enabled ? 1 : 0);
    expect(await ensureBundledExtensionsInstalled(root, bundled)).toEqual([]);
    expect((await store.listRecords())).toHaveLength(1);
  });
});
