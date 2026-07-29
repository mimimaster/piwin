import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allowNetworkFetchHost,
  allowNetworkWebSearch,
  addBashAllowRule,
  addFileWriteAllowRule,
  getBashAllowlist,
  getFileWriteAllowlist,
  getProjectNetworkPolicy,
  listProjects,
  listRememberedPermissions,
  openOrCreateProject,
  revokeRememberedPermission,
  saveProjectStore,
  setProjectTrust,
} from './project-store.js';

describe('project-store', () => {
  it('opens, trusts, and lists projects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-project-'));
    const filePath = join(dir, 'projects.json');
    const opened = await openOrCreateProject(filePath, '/tmp/demo-project');
    expect(opened.trust).toBe('untrusted');
    const trusted = await setProjectTrust(filePath, '/tmp/demo-project', 'trusted');
    expect(trusted.trust).toBe('trusted');
    const projects = await listProjects(filePath);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.path).toContain('demo-project');
  });

  it('remembers network allow policy per project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-project-net-'));
    const filePath = join(dir, 'projects.json');
    await openOrCreateProject(filePath, '/tmp/net-project', { trust: 'trusted' });
    await allowNetworkFetchHost(filePath, '/tmp/net-project', 'example.com');
    await allowNetworkWebSearch(filePath, '/tmp/net-project');
    const policy = await getProjectNetworkPolicy(filePath, '/tmp/net-project');
    expect(policy.allowedFetchHosts).toContain('example.com');
    expect(policy.allowWebSearch).toBe(true);
  });

  it('lists and revokes remembered permissions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-project-perms-'));
    const filePath = join(dir, 'projects.json');
    await openOrCreateProject(filePath, '/tmp/perm-project', { trust: 'trusted' });
    await allowNetworkFetchHost(filePath, '/tmp/perm-project', 'example.com');
    await allowNetworkWebSearch(filePath, '/tmp/perm-project');
    const listed = await listRememberedPermissions(filePath, '/tmp/perm-project');
    expect(listed.map((item) => item.key).sort()).toEqual([
      'network:fetch:example.com',
      'network:web_search',
    ]);
    await revokeRememberedPermission(filePath, '/tmp/perm-project', 'network:web_search');
    await revokeRememberedPermission(filePath, '/tmp/perm-project', 'network:fetch:example.com');
    const after = await listRememberedPermissions(filePath, '/tmp/perm-project');
    expect(after).toEqual([]);
    const network = await getProjectNetworkPolicy(filePath, '/tmp/perm-project');
    expect(network.allowWebSearch).toBe(false);
    expect(network.allowedFetchHosts).toEqual([]);
  });

  it('strips legacy mcpPolicy on save', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-project-mcp-migrate-'));
    const filePath = join(dir, 'projects.json');
    await saveProjectStore(filePath, {
      version: 1,
      projects: [
        {
          path: '/tmp/legacy-mcp-project',
          trust: 'trusted',
          lastOpenedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          // Legacy field retained only long enough to be stripped on write.
          mcpPolicy: { allowedServerIds: ['old-server'] },
        } as never,
      ],
    });

    const reloaded = await listProjects(filePath);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).not.toHaveProperty('mcpPolicy');
  });

  it('remembers and revokes bash allow rules with exact commands', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-project-bash-'));
    const filePath = join(dir, 'projects.json');
    await openOrCreateProject(filePath, '/tmp/bash-project', { trust: 'trusted' });
    await addBashAllowRule(filePath, '/tmp/bash-project', 'rm -rf /tmp/foo');
    // duplicate push is a no-op
    await addBashAllowRule(filePath, '/tmp/bash-project', 'rm -rf /tmp/foo');
    const allowlist = await getBashAllowlist(filePath, '/tmp/bash-project');
    expect(allowlist).toEqual(['rm -rf /tmp/foo']);
    // a distinct command is stored separately (no prefix collapse)
    await addBashAllowRule(filePath, '/tmp/bash-project', 'rm -rf /tmp/foobar');
    expect(await getBashAllowlist(filePath, '/tmp/bash-project')).toEqual([
      'rm -rf /tmp/foo',
      'rm -rf /tmp/foobar',
    ]);

    const listed = await listRememberedPermissions(filePath, '/tmp/bash-project');
    expect(listed.map((item) => item.key).sort()).toEqual([
      'bash:rm -rf /tmp/foo',
      'bash:rm -rf /tmp/foobar',
    ]);

    await revokeRememberedPermission(filePath, '/tmp/bash-project', 'bash:rm -rf /tmp/foo');
    expect(await getBashAllowlist(filePath, '/tmp/bash-project')).toEqual(['rm -rf /tmp/foobar']);
    const after = await listRememberedPermissions(filePath, '/tmp/bash-project');
    expect(after.map((item) => item.key)).toEqual(['bash:rm -rf /tmp/foobar']);
  });

  it('remembers and revokes file-write allow rules with normalized paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-project-fw-'));
    const filePath = join(dir, 'projects.json');
    await openOrCreateProject(filePath, '/tmp/fw-project', { trust: 'trusted' });
    await addFileWriteAllowRule(filePath, '/tmp/fw-project', '/etc/config.toml');
    // duplicate is a no-op; trailing slash normalizes to same entry
    await addFileWriteAllowRule(filePath, '/tmp/fw-project', '/etc/config.toml/');
    const allowlist = await getFileWriteAllowlist(filePath, '/tmp/fw-project');
    expect(allowlist).toEqual(['/etc/config.toml']);

    const listed = await listRememberedPermissions(filePath, '/tmp/fw-project');
    expect(listed.map((item) => item.key)).toEqual(['file-write:/etc/config.toml']);

    await revokeRememberedPermission(filePath, '/tmp/fw-project', 'file-write:/etc/config.toml');
    expect(await getFileWriteAllowlist(filePath, '/tmp/fw-project')).toEqual([]);
    const after = await listRememberedPermissions(filePath, '/tmp/fw-project');
    expect(after).toEqual([]);
  });

  it('revoking an unknown permission key is a no-op', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-project-unknown-'));
    const filePath = join(dir, 'projects.json');
    await openOrCreateProject(filePath, '/tmp/unknown-project', {
      trust: 'trusted',
    });
    await addBashAllowRule(filePath, '/tmp/unknown-project', 'ls');
    const after = await revokeRememberedPermission(
      filePath,
      '/tmp/unknown-project',
      'bash:does-not-exist',
    );
    expect(after.map((item) => item.key)).toEqual(['bash:ls']);
    expect(await getBashAllowlist(filePath, '/tmp/unknown-project')).toEqual(['ls']);
  });
});
