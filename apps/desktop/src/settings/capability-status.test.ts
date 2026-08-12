import { describe, expect, it } from 'vitest';
import type { PiwinConfig, SessionRuntimeStatus } from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import { resolveCapabilityStatuses } from './capability-status';

function baseConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    agentMock: false,
    providers: [],
    media: { maxPasteBytes: 1024, allowedMimeTypes: ['image/png'] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1024,
    },
  };
}

function staleRuntime(): SessionRuntimeStatus {
  return { sessionId: 's1', state: 'stale', staleDomains: ['web'] };
}

function liveRuntime(): SessionRuntimeStatus {
  return { sessionId: 's1', state: 'live', staleDomains: [] };
}

describe('resolveCapabilityStatuses', () => {
  it('web search effective requires a ready source', () => {
    const config = baseConfig();
    config.web = createDefaultWebConfig();
    const statuses = resolveCapabilityStatuses({ config, runtimeStatus: liveRuntime() });
    const web = statuses.find((item) => item.key === 'webSearch');
    expect(web?.configured).toBe('on');
    expect(web?.effective).toBe(true);
    expect(web?.loaded).toBe(true);
  });

  it('web search with provider none is off and not effective', () => {
    const config = baseConfig();
    config.web = { ...createDefaultWebConfig(), searchProvider: 'none', searchSources: [] };
    const statuses = resolveCapabilityStatuses({ config, runtimeStatus: liveRuntime() });
    const web = statuses.find((item) => item.key === 'webSearch');
    expect(web?.configured).toBe('off');
    expect(web?.effective).toBe(false);
    expect(web?.note).toContain('No search provider');
  });

  it('treats a valid model delegate as effective when ordinary sources are off', () => {
    const config = baseConfig();
    config.providers = [
      {
        id: 'gemini',
        name: 'Gemini',
        protocol: 'google-gemini',
        baseUrl: 'https://example.test',
        models: [{ id: 'search', capabilities: ['native-web-search'] }],
      },
    ];
    config.web = {
      ...createDefaultWebConfig(),
      searchProvider: 'none',
      searchSources: [],
      searchDelegateModel: {
        protocol: 'google-gemini',
        providerId: 'gemini',
        modelId: 'search',
      },
    };

    const web = resolveCapabilityStatuses({ config, runtimeStatus: liveRuntime() }).find(
      (item) => item.key === 'webSearch',
    );
    expect(web?.configured).toBe('on');
    expect(web?.effective).toBe(true);
  });

  it('stale runtime reports loaded=false for every capability', () => {
    const config = baseConfig();
    const statuses = resolveCapabilityStatuses({ config, runtimeStatus: staleRuntime() });
    for (const status of statuses) {
      expect(status.loaded).toBe(false);
    }
  });

  it('MCP running state is distinct from configured', () => {
    const config = baseConfig();
    const stopped = resolveCapabilityStatuses({
      config,
      runtimeStatus: liveRuntime(),
      services: { mcpRunning: false, processRunning: false, browserRunning: false },
    });
    const mcpStopped = stopped.find((item) => item.key === 'mcp');
    expect(mcpStopped?.effective).toBe(false);
    expect(mcpStopped?.running).toBe(false);

    const started = resolveCapabilityStatuses({
      config,
      runtimeStatus: liveRuntime(),
      services: { mcpRunning: true, processRunning: true, browserRunning: true },
    });
    const mcpStarted = started.find((item) => item.key === 'mcp');
    expect(mcpStarted?.effective).toBe(true);
    expect(mcpStarted?.running).toBe(true);
  });

  it('process off via config is not effective but manual product UI stays available', () => {
    const config = baseConfig();
    config.process = {
      enabled: false,
      maxProcesses: 8,
      killOnSessionEnd: false,
      killOnHostDispose: true,
    };
    const statuses = resolveCapabilityStatuses({ config, runtimeStatus: liveRuntime() });
    const processStatus = statuses.find((item) => item.key === 'process');
    expect(processStatus?.configured).toBe('off');
    expect(processStatus?.effective).toBe(false);
  });
});
