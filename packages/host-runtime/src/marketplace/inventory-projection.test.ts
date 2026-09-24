import type {
  ExtensionDeploymentRecord,
  ExtensionSummary,
  InstalledExtensionRecord,
  MarketplaceCatalogEntry,
  SkillSummary,
} from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import {
  computeInventoryRevision,
  projectMarketplaceInventory,
  type InventoryProjectionInput,
} from './inventory-projection.js';

function extension(overrides: Partial<ExtensionSummary> = {}): ExtensionSummary {
  return {
    id: 'hello',
    name: 'hello',
    description: 'Says hello',
    source: 'user',
    path: '/tmp/hello.ts',
    enabled: true,
    managed: true,
    contentRevision: 'rev-1',
    compatibility: { tier: 'compatible' },
    ...overrides,
  };
}

function managedRecord(overrides: Partial<InstalledExtensionRecord> = {}): InstalledExtensionRecord {
  return {
    id: 'hello',
    name: 'hello',
    description: 'Says hello',
    configuredEnabled: true,
    selectedRevision: 'rev-1',
    revisions: [],
    ...overrides,
  };
}

function input(overrides: Partial<InventoryProjectionInput> = {}): InventoryProjectionInput {
  return {
    extensions: [],
    managedRecords: [],
    skills: [],
    mcpServers: {},
    mcpHealth: [],
    matchCatalogEntry: () => undefined,
    ...overrides,
  };
}

function only(data: ReturnType<typeof projectMarketplaceInventory>) {
  expect(data.items).toHaveLength(1);
  const [item] = data.items;
  if (!item) throw new Error('missing item');
  return item;
}

describe('projectMarketplaceInventory — extensions', () => {
  it('reports installed (not available) when no session runtime is live', () => {
    const item = only(
      projectMarketplaceInventory(input({ extensions: [extension()], managedRecords: [managedRecord()] })),
    );
    expect(item.availability).toBe('installed');
    expect(item.removal).toEqual({ command: 'extensions/uninstall' });
  });

  it('is available only when the live runtime compiled this exact revision', () => {
    const live = projectMarketplaceInventory(
      input({
        extensions: [extension()],
        managedRecords: [managedRecord()],
        session: { loadedExtensions: [{ resourceId: 'hello', contentRevision: 'rev-1' }] },
      }),
    );
    expect(only(live).availability).toBe('available');

    const stale = projectMarketplaceInventory(
      input({
        extensions: [extension({ contentRevision: 'rev-2' })],
        managedRecords: [managedRecord()],
        session: { loadedExtensions: [{ resourceId: 'hello', contentRevision: 'rev-1' }] },
      }),
    );
    expect(only(stale).availability).toBe('pending-apply');
  });

  it('surfaces a failed deployment instead of waiting forever', () => {
    const deployment: ExtensionDeploymentRecord = {
      deploymentId: 'd1',
      sessionId: 's1',
      targetRegistryRevision: 'r',
      when: 'after-current-run',
      phase: 'rolled-back',
      error: 'boom',
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    };
    const item = only(
      projectMarketplaceInventory(
        input({
          extensions: [extension()],
          managedRecords: [managedRecord()],
          session: { loadedExtensions: [], latestDeployment: deployment },
        }),
      ),
    );
    expect(item.availability).toBe('failed');
    expect(item.message).toContain('boom');
  });

  it('never calls an incompatible extension available or pending', () => {
    const item = only(
      projectMarketplaceInventory(
        input({
          extensions: [
            extension({
              compatibility: { tier: 'incompatible', incompatibilityReason: 'fatal-custom-tui' },
            }),
          ],
          session: { loadedExtensions: [] },
        }),
      ),
    );
    expect(item.availability).toBe('failed');
  });

  it('shows pending removal and hides a second uninstall', () => {
    const item = only(
      projectMarketplaceInventory(
        input({
          extensions: [extension({ enabled: false })],
          managedRecords: [managedRecord({ configuredEnabled: false, installationState: 'pending-removal' })],
        }),
      ),
    );
    expect(item.availability).toBe('pending-removal');
    expect(item.removal).toBeUndefined();
    expect(item.canToggle).toBe(false);
  });

  it('routes Pi package extensions to package removal and links the catalog entry', () => {
    const entry = { entryId: 'extension:pi-lens' } as MarketplaceCatalogEntry;
    const item = only(
      projectMarketplaceInventory(
        input({
          extensions: [
            extension({
              id: 'pi-lens',
              source: 'pi-native',
              managed: false,
              piPackageSource: 'npm:pi-lens@4.2.1',
            }),
          ],
          matchCatalogEntry: (kind, id) => (kind === 'extension' && id === 'pi-lens' ? entry : undefined),
        }),
      ),
    );
    expect(item.removal).toEqual({
      command: 'marketplace/package-remove',
      packageSource: 'npm:pi-lens@4.2.1',
    });
    expect(item.catalogEntryId).toBe('extension:pi-lens');
  });

  it('offers no removal for bundled extensions', () => {
    const item = only(
      projectMarketplaceInventory(input({ extensions: [extension({ source: 'bundled', managed: false })] })),
    );
    expect(item.removal).toBeUndefined();
  });
});

describe('projectMarketplaceInventory — skills and MCP', () => {
  const skill = (overrides: Partial<SkillSummary> = {}): SkillSummary => ({
    id: 'doc-coauthoring',
    name: 'doc-coauthoring',
    description: 'Docs',
    source: 'user',
    path: '/tmp/skill',
    enabled: true,
    ...overrides,
  });

  it('maps skill enablement and only lets user skills be uninstalled', () => {
    const data = projectMarketplaceInventory(
      input({
        skills: [
          skill(),
          skill({ id: 'bundled-one', source: 'bundled' }),
          skill({ id: 'off', enabled: false }),
          skill({ id: 'hidden', hidden: true }),
        ],
      }),
    );
    const byId = new Map(data.items.map((item) => [item.capabilityId, item]));
    expect(byId.get('doc-coauthoring')?.availability).toBe('available');
    expect(byId.get('doc-coauthoring')?.removal).toEqual({ command: 'skills/uninstall' });
    expect(byId.get('bundled-one')?.removal).toBeUndefined();
    expect(byId.get('bundled-one')?.canToggle).toBe(false);
    expect(byId.get('off')?.availability).toBe('disabled');
    expect(byId.has('hidden')).toBe(false);
  });

  it('separates configured, running, failed and misconfigured MCP servers', () => {
    const data = projectMarketplaceInventory(
      input({
        mcpServers: {
          idle: { command: 'npx' },
          live: { command: 'npx' },
          broken: { command: 'npx' },
          needsKey: { command: 'npx', env: { API_KEY: '' } },
          off: { command: 'npx', disabled: true },
        },
        mcpHealth: [
          { serverId: 'live', status: 'running', command: 'npx', disabled: false, toolCount: 3 },
          {
            serverId: 'broken',
            status: 'error',
            command: 'npx',
            disabled: false,
            toolCount: 0,
            lastError: 'spawn ENOENT',
          },
        ],
      }),
    );
    const byId = new Map(data.items.map((item) => [item.capabilityId, item]));
    expect(byId.get('idle')?.availability).toBe('installed');
    expect(byId.get('live')?.availability).toBe('available');
    expect(byId.get('broken')?.availability).toBe('failed');
    expect(byId.get('broken')?.message).toBe('spawn ENOENT');
    expect(byId.get('needsKey')?.availability).toBe('configuration-required');
    expect(byId.get('off')?.availability).toBe('disabled');
    expect(byId.get('live')?.removal).toEqual({ command: 'mcp/remove' });
  });
});

describe('computeInventoryRevision', () => {
  it('is order-independent and changes when an item changes', () => {
    const data = projectMarketplaceInventory(
      input({ mcpServers: { a: { command: 'x' }, b: { command: 'y' } } }),
    );
    expect(computeInventoryRevision([...data.items].reverse())).toBe(data.revision);
    const changed = data.items.map((item) =>
      item.capabilityId === 'a' ? { ...item, availability: 'failed' as const } : item,
    );
    expect(computeInventoryRevision(changed)).not.toBe(data.revision);
  });
});
