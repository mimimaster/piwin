import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  HostToolExecutionContext,
  HostToolRegistration,
  PermissionDecision,
  PermissionMode,
} from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import { createBundledRuleSet } from './permission-defaults.js';
import { allowNetworkFetchHost, allowNetworkWebSearch, openOrCreateProject } from '@piwin/project';
import { buildSessionTools } from './session-tools.js';
import { createHostToolAdmission } from './tools/tool-admission.js';
import { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';

const context: HostToolExecutionContext = {
  sessionId: 'session-1',
  runtimeGenerationId: 'generation-1',
  runId: 'run-1',
  toolName: 'web_search',
};

async function executeThroughAdmission(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
  mode: () => PermissionMode = () => 'auto',
  requestPermission?: (input: {
    action: string;
    detail: string;
    defaultDecision: PermissionDecision;
    signal?: AbortSignal;
  }) => Promise<PermissionDecision>,
  projectPath?: string,
  projectsFilePath?: string,
) {
  const admission = createHostToolAdmission({
    rules: createBundledRuleSet(),
    getPermissionMode: mode,
    ...(requestPermission ? { requestPermission } : {}),
    projectRoot: projectPath ?? '/tmp',
    ...(projectPath ? { projectPath } : {}),
    ...(projectsFilePath ? { projectsFilePath } : {}),
  });
  const router = new HostToolExecutionRouter({
    tools: [tool],
    admission,
  });
  return router.execute(tool.descriptor.name, args, new AbortController().signal, {
    ...context,
    toolName: tool.descriptor.name,
  });
}

describe('buildSessionTools', () => {
  it('executes web_search through the configured model delegate port', async () => {
    const model = {
      protocol: 'google-gemini' as const,
      providerId: 'gemini',
      modelId: 'gemini-search',
    };
    const search = vi.fn(async () => [
      {
        title: 'Delegated result',
        url: 'https://example.com/delegated',
        snippet: 'fresh',
        source: 'model-delegate',
      },
    ]);
    const { tools } = buildSessionTools({
      webConfig: { ...createDefaultWebConfig(), searchDelegateModel: model },
      webSearchDelegate: { model, search },
    });
    const tool = tools.find((candidate) => candidate.descriptor.name === 'web_search');
    if (!tool) throw new Error('web_search missing');

    const result = await tool.execute({ query: 'latest' }, new AbortController().signal, context);

    if (!result.ok) throw new Error(result.message);
    expect(result.output).toContain('model-delegate:gemini/gemini-search');
    expect(result.output).toContain('Delegated result');
    expect(search).toHaveBeenCalledOnce();
  });

  it('returns raw registrations; permission decisions belong to Host admission', async () => {
    const { tools } = buildSessionTools({ webConfig: { searchProvider: 'none' } as never });
    const search = tools.find((tool) => tool.descriptor.name === 'web_search');
    expect(search?.permissionSpec.action).toBe('network:web_search');
    if (!search) throw new Error('web_search missing');
    await expect(executeThroughAdmission(search, { query: 'hello' })).resolves.toMatchObject({
      ok: false,
      code: 'permission-denied',
    });
  });

  it('blocks private fetch before the network executor', async () => {
    const { tools } = buildSessionTools({});
    const fetchTool = tools.find((tool) => tool.descriptor.name === 'web_fetch');
    if (!fetchTool) throw new Error('web_fetch missing');
    await expect(
      executeThroughAdmission(fetchTool, { url: 'http://127.0.0.1/' }),
    ).resolves.toMatchObject({ ok: false, code: 'permission-denied' });
  });

  it('uses the shared interactive gate before the web executor', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const { tools } = buildSessionTools({
      webConfig: {
        searchProvider: 'brave',
        fetchProvider: 'supermarkdown',
        fetchApiKeyEnv: 'FIRECRAWL_API_KEY',
        searchApiKeyEnv: 'MISSING_BRAVE_KEY_FOR_TEST',
        searchSources: [
          {
            id: 'brave',
            kind: 'brave',
            enabled: true,
            apiKeyEnv: 'MISSING_BRAVE_KEY_FOR_TEST',
          },
        ],
        searchStrategy: { mode: 'parallel', perSourceTimeoutMs: 800 },
        searchMaxResults: 3,
        searchTimeoutMs: 1000,
        searchRoutePolicy: 'external-first',
        fetchMaxBytes: 1000,
        fetchTimeoutMs: 1000,
        fetchBlockedUrlPrefixes: [],
      },
    });
    const search = tools.find((tool) => tool.descriptor.name === 'web_search');
    if (!search) throw new Error('web_search missing');
    await expect(
      executeThroughAdmission(search, { query: 'hello world' }, undefined, requestPermission),
    ).resolves.toMatchObject({ ok: false, code: 'execution-failed' });
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'network:web_search', detail: 'hello world' }),
    );
  });

  it('keeps remembered project network approvals in the shared gate', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-session-tools-'));
    const projectsFile = join(dir, 'projects.json');
    const projectPath = '/tmp/remember-project';
    await openOrCreateProject(projectsFile, projectPath, { trust: 'trusted' });
    await allowNetworkFetchHost(projectsFile, projectPath, 'example.com');
    await allowNetworkWebSearch(projectsFile, projectPath);

    const requestPermission = vi.fn(async () => 'deny' as const);
    const { tools } = buildSessionTools({
      webConfig: {
        searchProvider: 'brave',
        searchApiKeyEnv: 'MISSING_BRAVE_KEY_FOR_TEST',
        searchSources: [
          {
            id: 'brave',
            kind: 'brave',
            enabled: true,
            apiKeyEnv: 'MISSING_BRAVE_KEY_FOR_TEST',
          },
        ],
        searchStrategy: { mode: 'parallel', perSourceTimeoutMs: 800 },
        searchMaxResults: 3,
        searchTimeoutMs: 1000,
        searchRoutePolicy: 'external-first',
        fetchProvider: 'supermarkdown',
        fetchApiKeyEnv: 'FIRECRAWL_API_KEY',
        fetchMaxBytes: 1000,
        fetchTimeoutMs: 1000,
        fetchBlockedUrlPrefixes: [],
      },
    });

    const search = tools.find((tool) => tool.descriptor.name === 'web_search');
    if (!search) throw new Error('web_search missing');
    await expect(
      executeThroughAdmission(
        search,
        { query: 'cached search' },
        undefined,
        requestPermission,
        projectPath,
        projectsFile,
      ),
    ).resolves.toMatchObject({ ok: false, code: 'execution-failed' });
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
