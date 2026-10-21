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
    searchCommunitySkills: vi.fn(async () => []),
    listInstalledSkillIds: vi.fn(async () => new Set<string>()),
    searchCommunityMcp: vi.fn(async () => []),
    listMcpServerIds: vi.fn(async () => new Set<string>()),
    searchCommunityPackages: vi.fn(async () => []),
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

  it('appends skills.sh community skills to a skill search, curated first', async () => {
    const injected = ports({
      searchCommunitySkills: vi.fn(async () => [
        {
          entryId: 'skills.sh:anthropics/skills/frontend-design',
          name: 'frontend-design',
          version: 'HEAD',
          description: '',
          source: 'skill' as const,
          installCommand: '',
          repositoryUrl: 'https://github.com/anthropics/skills',
          curated: false,
        },
        {
          entryId: 'skills.sh:acme/tools/pdf-ocr',
          name: 'pdf-ocr',
          version: 'HEAD',
          description: '',
          source: 'skill' as const,
          installCommand: '',
          repositoryUrl: 'https://github.com/acme/tools',
          installs: 42,
          curated: false,
        },
      ]),
      listInstalledSkillIds: vi.fn(async () => new Set(['pdf-ocr'])),
    });
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
      ports: injected,
    });
    const result = await run(tool(tools, 'capability_search'), { query: 'design', kind: 'skill' });
    const entries = JSON.parse(result.ok ? result.output : '[]') as Array<Record<string, unknown>>;
    expect(entries[0]).toMatchObject({ entryId: 'skill:frontend-design', curated: true });
    expect(entries.at(-1)).toMatchObject({
      entryId: 'skills.sh:acme/tools/pdf-ocr',
      curated: false,
      installs: 42,
      installed: true,
    });
    // The community copy of a curated skill is dropped.
    expect(entries.filter((entry) => entry.name === 'frontend-design')).toHaveLength(0);
    expect(entries.some((entry) => entry.entryId === 'skills.sh:anthropics/skills/frontend-design')).toBe(false);
    expect(injected.searchCommunitySkills).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'design' }),
    );
  });

  it('keeps curated results and says so when skills.sh is unreachable', async () => {
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
      ports: ports({
        searchCommunitySkills: vi.fn(async () => {
          throw new Error('HTTP 503');
        }),
      }),
    });
    const result = await run(tool(tools, 'capability_search'), { query: 'frontend' });
    expect(result.ok && result.output).toContain('skill:frontend-design');
    expect(result.ok && result.output).toContain('Community sources unavailable: skills.sh: HTTP 503');
  });

  it('does not query skills.sh without a query or for other kinds', async () => {
    const injected = ports();
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
      ports: injected,
    });
    await run(tool(tools, 'capability_search'), {});
    await run(tool(tools, 'capability_search'), { query: 'memory', kind: 'mcp' });
    expect(injected.searchCommunitySkills).not.toHaveBeenCalled();
  });

  it('installs a community skill by locating it by name in its GitHub repo', async () => {
    const injected = ports({ installSkill: vi.fn(async () => ({ skillId: 'pdf-ocr' })) });
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
      ports: injected,
    });
    const result = await run(tool(tools, 'capability_install'), {
      entryId: 'skills.sh:acme/tools/pdf-ocr',
    });
    expect(result.ok && result.output).toContain('Installed community skill "pdf-ocr"');
    expect(injected.installSkill).toHaveBeenCalledWith({
      piwinRoot: '/tmp/piwin',
      source: { kind: 'git', url: 'https://github.com/acme/tools.git' },
      name: 'pdf-ocr',
    });
  });

  it('never overwrites an installed skill with a same-named community skill', async () => {
    const injected = ports({ listInstalledSkillIds: vi.fn(async () => new Set(['pdf-ocr'])) });
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
      ports: injected,
    });
    const result = await run(tool(tools, 'capability_install'), {
      entryId: 'skills.sh:acme/tools/pdf-ocr',
    });
    expect(result.ok && result.output).toContain('already installed');
    expect(injected.installSkill).not.toHaveBeenCalled();
  });

  it('tells the agent the permission prompt is the only confirmation', () => {
    const tools = buildCapabilityTools({
      piwinRoot: '/tmp/piwin',
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
    });
    const description = tool(tools, 'capability_install').descriptor.description;
    expect(description).toContain('do not ask for confirmation in chat');
    expect(description).not.toContain('Confirm with the user first');
  });

  it('searches the MCP registry and installs only a server it returned', async () => {
    const card = {
      id: 'official:io.github.acme/fs-mcp',
      title: 'fs-mcp',
      description: 'Files',
      source: 'official' as const,
      installDraft: { command: 'npx', args: ['-y', 'fs-mcp@1.0.0'] },
      requiredEnv: ['FS_ROOT'],
    };
    const manager = {
      applyConfig: vi.fn(async () => ({ changedServerIds: [], exposureChanged: false, warnings: [] })),
      start: vi.fn(),
    } as unknown as McpLifecycleManager;
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-cap-mcp-'));
    const tools = buildCapabilityTools({
      piwinRoot,
      mcpManager: manager,
      applyExtensions: async () => ({ ok: true, phase: 'queued' }),
      ports: ports({ searchCommunityMcp: vi.fn(async () => [card]) }),
    });
    const install = tool(tools, 'capability_install');
    const before = await run(install, { entryId: 'mcp-registry:io.github.acme/fs-mcp' });
    expect(before.ok).toBe(false);

    const search = await run(tool(tools, 'capability_search'), { query: 'files', kind: 'mcp' });
    const entries = JSON.parse(search.ok ? search.output : '[]') as Array<Record<string, unknown>>;
    expect(entries.at(-1)).toMatchObject({
      entryId: 'mcp-registry:io.github.acme/fs-mcp',
      curated: false,
      runnable: true,
      command: 'npx -y fs-mcp@1.0.0',
      requiredEnv: ['FS_ROOT'],
    });

    const result = await run(install, { entryId: 'mcp-registry:io.github.acme/fs-mcp' });
    expect(result.ok && result.output).toContain('needs FS_ROOT');
    // Needs env → saved with a placeholder, never started.
    expect(manager.start).not.toHaveBeenCalled();
    const saved = await loadMcpConfig(piwinRoot);
    expect(saved.mcpServers['fs-mcp']).toEqual({
      command: 'npx',
      args: ['-y', 'fs-mcp@1.0.0'],
      env: { FS_ROOT: '' },
    });
  });

  it('installs a community Pi package by its npm id and refuses native duplicates', async () => {
    const applyExtensions = vi.fn(async () => ({ ok: true as const, phase: 'queued' as const }));
    const injected = ports({
      searchCommunityPackages: vi.fn(async () => [
        {
          entryId: 'npm:pi-foo',
          name: 'pi-foo',
          version: '1.2.0',
          description: 'Foo tools',
          source: 'npm-pi-package' as const,
          installCommand: 'pi install npm:pi-foo',
          monthlyDownloads: 30,
        },
        {
          entryId: 'npm:pi-subagents',
          name: 'pi-subagents',
          version: '1.0.0',
          description: '',
          source: 'npm-pi-package' as const,
          installCommand: '',
        },
      ]),
    });
    const tools = buildCapabilityTools({ piwinRoot: '/tmp/piwin', applyExtensions, ports: injected });
    const search = await run(tool(tools, 'capability_search'), { query: 'foo', kind: 'extension' });
    const names = (JSON.parse(search.ok ? search.output : '[]') as Array<{ name: string }>).map(
      (entry) => entry.name,
    );
    expect(names).toContain('pi-foo');
    expect(names).not.toContain('pi-subagents');

    const install = tool(tools, 'capability_install');
    const result = await run(install, { entryId: 'npm:pi-foo' });
    expect(result.ok).toBe(true);
    expect(injected.installPiPackage).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'npm:pi-foo' }),
    );
    expect(applyExtensions).toHaveBeenCalledWith('after-current-run');
    expect((await run(install, { entryId: 'npm:pi-subagents' })).ok).toBe(false);
    expect((await run(install, { entryId: 'github:../../etc' })).ok).toBe(false);
  });
});
