import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  HostPush,
  HostResponse,
  MarketplaceCatalogListData,
  MarketplaceInstalledListData,
  McpServerHealth,
} from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { loadMcpConfig, saveMcpConfig } from '@piwin/mcp';
import type { McpLifecycleManager } from '@piwin/mcp';
import type { LoadedExtensionRef } from '../sessions/session-runtime-controller.js';
import { handleCapabilityRemovalCommand } from './capability-removal-commands.js';
import type { HostCommandContext } from './host-command-context.js';
import { handleMarketplaceCatalogCommand } from './marketplace-catalog-commands.js';

type Fixture = {
  context: HostCommandContext;
  pushes: HostPush[];
  loaded: Map<string, LoadedExtensionRef[]>;
  health: McpServerHealth[];
  stop: ReturnType<typeof vi.fn>;
};

function makeFixture(piwinRoot: string): Fixture {
  const pushes: HostPush[] = [];
  const loaded = new Map<string, LoadedExtensionRef[]>();
  const health: McpServerHealth[] = [];
  const stop = vi.fn(async (serverId: string): Promise<McpServerHealth> => ({
    serverId,
    status: 'stopped',
    command: 'npx',
    disabled: false,
    toolCount: 0,
  }));
  const manager = {
    listHealth: async () => health,
    stop,
    applyConfig: async () => ({ changedServerIds: [], exposureChanged: false, warnings: [] }),
  } as unknown as McpLifecycleManager;
  const context: HostCommandContext = {
    piwinRoot,
    push: (message) => {
      pushes.push(message);
    },
    requireSession: () => {
      throw new Error('not needed');
    },
    getMcpManager: () => manager,
    getLoadedExtensions: (sessionId) => loaded.get(sessionId),
    listLoadedExtensionRevisions: () =>
      new Set(
        [...loaded.values()].flatMap((refs) =>
          refs.flatMap((ref) => (ref.contentRevision ? [ref.contentRevision] : [])),
        ),
      ),
    getJobController: () => {
      throw new Error('not needed');
    },
    todoStore: {} as never,
    petStateStore: {} as never,
    runCronJob: async () => ({ ok: true }),
    pendingPermissions: new Map(),
    pendingExtensionUi: new Map(),
    rememberProjectPermission: async () => undefined,
    rememberSessionPermission: () => undefined,
    sessionPermissionOverrides: new Map(),
    setSessionPermissionOverride: () => undefined,
    clearSessionPermissionOverride: () => undefined,
  };
  return { context, pushes, loaded, health, stop };
}

function dataOf<T>(response: HostResponse | null): T {
  if (!response || !response.success) {
    throw new Error(`expected success, got ${JSON.stringify(response)}`);
  }
  return response.data as T;
}

async function installManagedExtension(piwinRoot: string): Promise<string> {
  const sourceDir = await mkdtemp(join(tmpdir(), 'piwin-market-ext-src-'));
  const sourcePath = join(sourceDir, 'hello.ts');
  await writeFile(sourcePath, '/** hello */\nexport default function () {}\n', 'utf8');
  const store = createExtensionRevisionStore(piwinRoot);
  const staged = await store.stage({ sourcePath });
  await store.setEnabled('hello', true);
  return staged.contentRevision;
}

describe('marketplace catalog commands', () => {
  it('lists and filters the curated catalog', async () => {
    const { context } = makeFixture(await mkdtemp(join(tmpdir(), 'piwin-market-')));
    const all = dataOf<MarketplaceCatalogListData>(
      await handleMarketplaceCatalogCommand({ type: 'marketplace/catalog-list' }, 'r1', context),
    );
    expect(all.entries.length).toBeGreaterThan(0);

    const mcp = dataOf<MarketplaceCatalogListData>(
      await handleMarketplaceCatalogCommand(
        { type: 'marketplace/catalog-list', kinds: ['mcp'] },
        'r2',
        context,
      ),
    );
    expect(mcp.entries.every((entry) => entry.kind === 'mcp')).toBe(true);

    const missing = await handleMarketplaceCatalogCommand(
      { type: 'marketplace/catalog-get', entryId: 'mcp:nope' },
      'r3',
      context,
    );
    expect(missing?.success).toBe(false);
  });

  it('reports session-true extension availability and links catalog MCP servers', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-market-inv-'));
    const fixture = makeFixture(piwinRoot);
    const revision = await installManagedExtension(piwinRoot);
    const document = await loadMcpConfig(piwinRoot);
    document.mcpServers.memory = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory@2026.8.31'] };
    await saveMcpConfig(piwinRoot, document);
    fixture.health.push({ serverId: 'memory', status: 'running', command: 'npx', disabled: false, toolCount: 9 });

    const beforeApply = dataOf<MarketplaceInstalledListData>(
      await handleMarketplaceCatalogCommand(
        { type: 'marketplace/installed-list', sessionId: 's1' },
        'r1',
        fixture.context,
      ),
    );
    const find = (data: MarketplaceInstalledListData, key: string) =>
      data.items.find((item) => item.installationKey === key);
    // Session s1 is not live: the Host cannot claim the extension is usable.
    expect(find(beforeApply, 'extension:hello')?.availability).toBe('installed');
    expect(find(beforeApply, 'mcp:memory')).toMatchObject({
      availability: 'available',
      catalogEntryId: 'mcp:memory',
    });

    fixture.loaded.set('s1', []);
    const live = dataOf<MarketplaceInstalledListData>(
      await handleMarketplaceCatalogCommand(
        { type: 'marketplace/installed-list', sessionId: 's1' },
        'r2',
        fixture.context,
      ),
    );
    expect(find(live, 'extension:hello')?.availability).toBe('pending-apply');

    fixture.loaded.set('s1', [{ resourceId: 'hello', contentRevision: revision }]);
    const applied = dataOf<MarketplaceInstalledListData>(
      await handleMarketplaceCatalogCommand(
        { type: 'marketplace/installed-list', sessionId: 's1' },
        'r3',
        fixture.context,
      ),
    );
    expect(find(applied, 'extension:hello')?.availability).toBe('available');
    expect(applied.revision).not.toBe(live.revision);
  });
});

describe('capability removal commands', () => {
  it('keeps a managed extension until its last runtime lets go, then deletes it', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-market-uninstall-'));
    const fixture = makeFixture(piwinRoot);
    const revision = await installManagedExtension(piwinRoot);
    fixture.loaded.set('s1', [{ resourceId: 'hello', contentRevision: revision }]);

    const pending = await handleCapabilityRemovalCommand(
      { type: 'extensions/uninstall', extensionId: 'hello' },
      'r1',
      fixture.context,
    );
    expect(dataOf(pending)).toEqual({ extensionId: 'hello', state: 'pending-removal' });
    expect(fixture.pushes.some((push) => push.type === 'extension/catalog-updated')).toBe(true);

    const whilePending = dataOf<MarketplaceInstalledListData>(
      await handleMarketplaceCatalogCommand({ type: 'marketplace/installed-list' }, 'r2', fixture.context),
    );
    expect(
      whilePending.items.find((item) => item.installationKey === 'extension:hello')?.availability,
    ).toBe('pending-removal');

    fixture.loaded.delete('s1');
    const afterRelease = dataOf<MarketplaceInstalledListData>(
      await handleMarketplaceCatalogCommand({ type: 'marketplace/installed-list' }, 'r3', fixture.context),
    );
    expect(afterRelease.items.some((item) => item.installationKey === 'extension:hello')).toBe(false);
    await expect(stat(join(piwinRoot, 'extensions', 'revisions', 'hello'))).rejects.toThrow();
  });

  it('removes immediately when no runtime holds the extension', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-market-uninstall-now-'));
    const fixture = makeFixture(piwinRoot);
    await installManagedExtension(piwinRoot);
    const response = await handleCapabilityRemovalCommand(
      { type: 'extensions/uninstall', extensionId: 'hello' },
      'r1',
      fixture.context,
    );
    expect(dataOf(response)).toEqual({ extensionId: 'hello', state: 'removed' });
  });

  it('refuses to uninstall an extension the Host does not manage', async () => {
    const fixture = makeFixture(await mkdtemp(join(tmpdir(), 'piwin-market-unmanaged-')));
    const response = await handleCapabilityRemovalCommand(
      { type: 'extensions/uninstall', extensionId: 'bundled-thing' },
      'r1',
      fixture.context,
    );
    expect(response?.success).toBe(false);
  });

  it('stops an MCP server before dropping it from config', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-market-mcp-'));
    const fixture = makeFixture(piwinRoot);
    const document = await loadMcpConfig(piwinRoot);
    document.mcpServers.time = { command: 'uvx', args: ['mcp-server-time==2026.8.18'] };
    await saveMcpConfig(piwinRoot, document);

    const response = await handleCapabilityRemovalCommand(
      { type: 'mcp/remove', serverId: 'time' },
      'r1',
      fixture.context,
    );
    expect(dataOf(response)).toEqual({ serverId: 'time' });
    expect(fixture.stop).toHaveBeenCalledWith('time');
    expect((await loadMcpConfig(piwinRoot)).mcpServers.time).toBeUndefined();

    const missing = await handleCapabilityRemovalCommand(
      { type: 'mcp/remove', serverId: 'time' },
      'r2',
      fixture.context,
    );
    expect(missing?.success).toBe(false);
  });

  it('keeps MCP config when the server refuses to stop', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-market-mcp-stuck-'));
    const fixture = makeFixture(piwinRoot);
    fixture.stop.mockResolvedValueOnce({
      serverId: 'time',
      status: 'stopping',
      command: 'uvx',
      disabled: false,
      toolCount: 0,
    });
    const document = await loadMcpConfig(piwinRoot);
    document.mcpServers.time = { command: 'uvx', args: ['mcp-server-time==2026.8.18'] };
    await saveMcpConfig(piwinRoot, document);

    const response = await handleCapabilityRemovalCommand(
      { type: 'mcp/remove', serverId: 'time' },
      'r1',
      fixture.context,
    );
    expect(response?.success).toBe(false);
    expect((await loadMcpConfig(piwinRoot)).mcpServers.time).toBeDefined();
  });
});
