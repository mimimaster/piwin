import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allowNetworkFetchHost,
  allowNetworkWebSearch,
  allowMcpServer,
  getProjectNetworkPolicy,
  getProjectMcpPolicy,
  listProjects,
  openOrCreateProject,
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

  it('remembers MCP server allowlist per project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-project-mcp-'));
    const filePath = join(dir, 'projects.json');
    await openOrCreateProject(filePath, '/tmp/mcp-project', { trust: 'trusted' });
    await allowMcpServer(filePath, '/tmp/mcp-project', 'fixture');
    await allowMcpServer(filePath, '/tmp/mcp-project', 'fixture');
    const policy = await getProjectMcpPolicy(filePath, '/tmp/mcp-project');
    expect(policy.allowedServerIds).toEqual(['fixture']);
  });
});
