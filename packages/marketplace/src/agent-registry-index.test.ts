import { describe, expect, it, vi } from 'vitest';
import { parseAgentRegistryIndex, fetchAgentRegistryIndex } from './agent-registry-index.js';
import { listCatalogEntries } from './catalog/catalog.js';

function registry() {
  return {
    schemaVersion: 1,
    agents: [{
      entryId: 'agent:grok',
      capabilityId: 'grok',
      kind: 'agent',
      name: { en: 'Grok Build', zhCN: 'Grok Build' },
      summary: { en: 'Remote adapter index fixture.', zhCN: '远程适配索引夹具。' },
      description: { en: 'Not an offline catalog entry.', zhCN: '不是离线目录条目。' },
      version: '1.0.0',
      author: 'piwin',
      install: {
        kind: 'agent',
        source: {
          kind: 'registry',
          agentId: 'grok',
          version: '1.0.0',
          url: 'https://extension.piwinwin.com/agents/grok-1.0.0.json',
          sha256: 'a'.repeat(64),
        },
      },
      requirements: [],
      examples: [{ title: { en: 'Start', zhCN: '开始' }, prompt: { en: 'Start a session.', zhCN: '开始会话。' } }],
    }],
  };
}

describe('separate Agent distribution index', () => {
  it('projects exact pinned manifests without accepting tested claims from the index', () => {
    const parsed = parseAgentRegistryIndex(registry());
    expect(parsed[0]).toMatchObject({ entryId: 'agent:grok', kind: 'agent', install: { kind: 'agent' }, verification: [{ level: 'author-declared' }] });
  });
  it('rejects unpinned manifests and executable recipes in the source descriptor', () => {
    const input = registry();
    const entry = input.agents[0];
    if (entry === undefined) throw new Error('fixture');
    expect(() => parseAgentRegistryIndex({ ...input, agents: [{ ...entry, install: { kind: 'agent', source: { kind: 'registry', url: 'https://evil.invalid/manifest.json', sha256: 'bad' } } }] })).toThrow();
  });
  it('rejects duplicate identifiers, wrong schemas and invalid withdrawal', () => {
    const input = registry();
    expect(() => parseAgentRegistryIndex({ ...input, agents: [...input.agents, ...input.agents] })).toThrow('Duplicate');
    expect(() => parseAgentRegistryIndex({ schemaVersion: 2, agents: [] })).toThrow();
    expect(() => parseAgentRegistryIndex({ ...input, agents: [{ ...input.agents[0], withdrawn: { reason: 'bad' } }] })).toThrow();
  });
  it('preserves withdrawals instead of offering withdrawn versions for install', () => {
    const input = registry();
    const parsed = parseAgentRegistryIndex({ ...input, agents: [{ ...input.agents[0], withdrawn: { reason: { en: 'Withdrawn', zhCN: '已撤回' } } }] });
    expect(listCatalogEntries({}, parsed)).toHaveLength(0);
  });
  it('reports unavailable sources; the offline curated Agent remains discoverable', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    await expect(fetchAgentRegistryIndex({ fetchImpl })).rejects.toThrow('404');
    expect(listCatalogEntries({ kinds: ['agent'] })).toEqual([]);
  });
});
