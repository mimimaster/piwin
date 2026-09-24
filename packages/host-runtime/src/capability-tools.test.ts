import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HostToolRegistration, McpServerHealth } from '@piwin/contracts';
import type { McpLifecycleManager } from '@piwin/mcp';
import { loadMcpConfig } from '@piwin/mcp';
import { buildCapabilityTools, type CapabilityInstallPorts } from './capability-tools.js';
import { toolFamilyIndex } from './tools/tool-family-index.js';

function tool(tools: HostToolRegistration[], name: string): HostToolRegistration {
  const found = tools.find((candidate) => candidate.descriptor.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

function ports(overrides: Partial<CapabilityInstallPorts> = {}): Partial<CapabilityInstallPorts> {
  return {
    installSkill: vi.fn(async () => ({ skillId: 'doc-coauthoring' })),
    installPiPackage: vi.fn(async () => undefined),
    installManagedExtension: vi.fn(async () => ({ extensionId: 'x' })),
    enableManagedExtension: vi.fn(async () => undefined),
    listInstalledEntryIds: vi.fn(async () => new Set<string>()),
    ...overrides,
  };
}

async function run(registration: HostToolRegistration, args: Record<string, unknown>) {
  return registration.execute(args, new AbortController().signal, {} as never);
}

describe('capability tools', () => {
  it('pass session tool registration validation (regression: side chat failed to open)', () => {
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
    });
    expect(() => toolFamilyIndex(tools)).not.toThrow();
  });

  it('searches the curated catalog and marks installed entries', async () => {
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
      ports: ports({ listInstalledEntryIds: async () => new Set(['mcp:memory']) }),
    });
    const result = await run(tool(tools, 'capability_search'), { kind: 'mcp' });
    expect(result.ok).toBe(true);
    const entries = JSON.parse(result.ok ? result.output : '[]') as Array<{ entryId: string; installed: boolean }>;
    expect(entries.every((entry) => entry.entryId.startsWith('mcp:'))).toBe(true);
    expect(entries.find((entry) => entry.entryId === 'mcp:memory')?.installed).toBe(true);
    expect(entries.find((entry) => entry.entryId === 'mcp:sequential-thinking')?.installed).toBe(false);
  });

  it('asks for a permission prompt per install and never remembers it', () => {
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
    });
    const install = tool(tools, 'capability_install');
    expect(install.permissionSpec?.rememberable).toBe(false);
    expect(install.permissionSpec?.readOnly).not.toBe(true);
    expect(install.permissionSpec?.subjectBuilder?.({ entryId: 'skill:x' }, {} as never)).toEqual({
      kind: 'tool',
      action: 'capabilities:install skill:x',
    });
  });

  it('only installs catalog entries, and skips ones already installed', async () => {
    const injected = ports({ listInstalledEntryIds: async () => new Set(['skill:doc-coauthoring']) });
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
      ports: injected,
    });
    const install = tool(tools, 'capability_install');
    const unknown = await run(install, { entryId: 'skill:https://evil.example/repo' });
    expect(unknown.ok).toBe(false);
    const again = await run(install, { entryId: 'skill:doc-coauthoring' });
    expect(again.ok && again.output).toContain('already installed');
    expect(injected.installSkill).not.toHaveBeenCalled();
  });

  it('installs a skill from its pinned catalog source', async () => {
    const injected = ports();
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
      ports: injected,
    });
    const result = await run(tool(tools, 'capability_install'), { entryId: 'skill:doc-coauthoring' });
    expect(result.ok).toBe(true);
    expect(injected.installSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        piwinRoot: '/tmp/piwin',
        source: expect.objectContaining({ kind: 'git', ref: expect.stringMatching(/^[0-9a-f]{40}$/) }),
      }),
    );
  });

  it('installs a Pi package at its pinned version and schedules activation', async () => {
    const injected = ports();
    const applyExtensions = vi.fn(async () => ({ ok: true as const, phase: 'waiting-current-run' }));
    const tools = buildCapabilityTools({ piwinRoot: '/tmp/piwin', applyExtensions, ports: injected });
    const result = await run(tool(tools, 'capability_install'), { entryId: 'extension:ff-labs-pi-fff' });
    expect(result.ok && result.output).toContain('activates after this turn');
    expect(injected.installPiPackage).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'npm:@ff-labs/pi-fff@0.11.0' }),
    );
    expect(applyExtensions).toHaveBeenCalledWith('after-current-run');
  });

  it('reports an MCP server that saved but did not start as a failure', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-capability-mcp-'));
    const health: McpServerHealth = {
      serverId: 'memory',
      status: 'error',
      command: 'npx',
      disabled: false,
      toolCount: 0,
      lastError: 'spawn npx ENOENT',
    };
    const manager = {
      applyConfig: async () => ({ changedServerIds: [], exposureChanged: false, warnings: [] }),
      start: async () => health,
      discoverTools: async () => [],
      listHealth: async () => [health],
    } as unknown as McpLifecycleManager;
    const tools = buildCapabilityTools({
      piwinRoot,
      mcpManager: manager,
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
      ports: ports(),
    });
    const result = await run(tool(tools, 'capability_install'), { entryId: 'mcp:memory' });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain('ENOENT');
    // The config stays so the user can fix the prerequisite and start it.
    expect((await loadMcpConfig(piwinRoot)).mcpServers.memory).toBeDefined();
  });
});
