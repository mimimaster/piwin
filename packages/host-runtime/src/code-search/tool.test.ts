import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODE_SEARCH_TOOL_DESCRIPTION, buildCodeSearchTool, resolveCodeSearchBackend } from './tool.js';
import type { CodeSearchConfig, ModelProviderConfig } from '@piwin/contracts';
import type { CodeSearchCompletionPort } from './completion-port.js';
import { CODE_SEARCH_ANSWER_TOOL } from './tool-schema.js';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'piwin-code-search-tool-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/app.ts'), 'export const createHandler = () => 1;\n');
});

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
  }
});

function answerPort(xml: string): CodeSearchCompletionPort {
  return async () => ({
    text: '',
    toolCalls: [{ id: 'a1', name: CODE_SEARCH_ANSWER_TOOL, arguments: { answer: xml } }],
  });
}

const ENABLED_MODEL_CONFIG: CodeSearchConfig = {
  enabled: true,
  backend: 'model',
  model: { providerId: 'custom-openai', modelId: 'gpt-5-mini' },
};

function provider(): ModelProviderConfig {
  return {
    id: 'custom-openai',
    protocol: 'openai-compatible',
    name: 'Custom',
    baseUrl: 'http://127.0.0.1:9999/v1',
    models: [{ id: 'gpt-5-mini' }],
  };
}

type BuildToolOptions = Partial<Parameters<typeof buildCodeSearchTool>[0]> & {
  /** Gate tests need the real backend readiness check, not an injected port. */
  injectPort?: boolean;
};

function buildTool({ injectPort = true, ...overrides }: BuildToolOptions = {}) {
  return buildCodeSearchTool({
    cwd: root,
    config: ENABLED_MODEL_CONFIG,
    resolveModel: () => ({ provider: provider(), modelId: 'gpt-5-mini' }),
    ...(injectPort
      ? {
          completionPort: answerPort(
            '<ANSWER><file path="/codebase/src/app.ts"><range>1-1</range></file></ANSWER>',
          ),
        }
      : {}),
    ...overrides,
  });
}

describe('buildCodeSearchTool descriptor', () => {
  it('exposes exactly the two verified parameters', () => {
    const tool = buildTool();
    expect(tool?.descriptor.name).toBe('code_search');
    const properties = (tool?.descriptor.parameters as { properties: Record<string, unknown> })
      .properties;
    expect(Object.keys(properties)).toEqual(['search_term', 'search_folder_absolute_uri']);
    expect((tool?.descriptor.parameters as { required: string[] }).required).toEqual([
      'search_term',
      'search_folder_absolute_uri',
    ]);
  });

  it('uses the Devin tool description with the prefer-first and no-parallel rules', () => {
    expect(CODE_SEARCH_TOOL_DESCRIPTION).toContain(
      "A search subagent the user refers to as 'Fast Context'",
    );
    expect(CODE_SEARCH_TOOL_DESCRIPTION).toContain(
      'You should always use this tool to start your search',
    );
    expect(CODE_SEARCH_TOOL_DESCRIPTION).toContain(
      'IMPORTANT: YOU CANNOT CALL THIS TOOL IN PARALLEL.',
    );
  });

  it('declares itself as a read-only workspace peer', () => {
    const tool = buildTool();
    expect(tool?.family).toBe('filesystem-read');
    expect(tool?.permissionSpec.readOnly).toBe(true);
    expect(tool?.fileEffect).toEqual({ kind: 'none' });
  });
});

describe('buildCodeSearchTool gating', () => {
  it('is absent when the feature is disabled', () => {
    expect(buildTool({ config: { enabled: false } })).toBeUndefined();
    expect(buildTool({ config: undefined })).toBeUndefined();
  });

  it('is absent when the model backend cannot resolve any chat model', () => {
    expect(
      buildTool({
        injectPort: false,
        config: { enabled: true, backend: 'model' },
        resolveModel: () => undefined,
      }),
    ).toBeUndefined();
  });

  it('registers windsurf with an empty config by reusing the Devin oauth account', () => {
    expect(buildTool({ injectPort: false, config: { enabled: true, backend: 'windsurf' } })).toBeDefined();
  });

  it('is absent when the selected model is not configured', () => {
    expect(buildTool({ injectPort: false, resolveModel: () => undefined })).toBeUndefined();
  });
});

describe('resolveCodeSearchBackend', () => {
  it('treats an empty windsurf config as ready via oauth:devin', () => {
    const readiness = resolveCodeSearchBackend({
      cwd: root,
      config: { enabled: true, backend: 'windsurf' },
    });
    expect(readiness.ready).toBe(true);
  });

  it('keeps an explicit windsurf apiKeyEnv instead of filling oauth:devin', async () => {
    const secretReads: string[] = [];
    let sawExplicitToken = false;
    const readiness = resolveCodeSearchBackend({
      cwd: root,
      config: { enabled: true, backend: 'windsurf', apiKeyEnv: 'WINDSURF_API_KEY' },
      env: { WINDSURF_API_KEY: 'explicit-env-token' },
      readSecretByRef: async (ref) => {
        secretReads.push(ref);
        return null;
      },
      fetch: (async (_input, init) => {
        const body = init?.body;
        const raw = typeof body === 'string' ? body : body instanceof Uint8Array ? Buffer.from(body).toString('utf8') : '';
        if (raw.includes('explicit-env-token')) {
          sawExplicitToken = true;
        }
        if (raw.includes('oauth:devin')) {
          throw new Error('oauth:devin was sent instead of the explicit env token');
        }
        return new Response(new Uint8Array(), { status: 401 });
      }) as typeof fetch,
    });
    expect(readiness.ready).toBe(true);
    if (!readiness.ready) {
      return;
    }
    await expect(
      readiness.port({
        systemPrompt: 's',
        messages: [{ role: 'user', content: 'q' }],
        tools: [],
        timeoutMs: 1000,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(secretReads).toEqual([]);
    expect(sawExplicitToken).toBe(true);
  });

  it('explains why a model backend is not ready', () => {
    const readiness = resolveCodeSearchBackend({
      cwd: root,
      config: { enabled: true, backend: 'model' },
    });
    expect(readiness.ready).toBe(false);
    if (!readiness.ready) {
      expect(readiness.reason).toContain('no chat model is configured');
    }
  });

  it('builds a windsurf port once credentials exist', () => {
    const readiness = resolveCodeSearchBackend({
      cwd: root,
      config: { enabled: true, backend: 'windsurf', apiKeyEnv: 'WINDSURF_API_KEY' },
    });
    expect(readiness.ready).toBe(true);
  });

  it('never falls back from windsurf to model', () => {
    const readiness = resolveCodeSearchBackend({
      cwd: root,
      config: {
        enabled: true,
        backend: 'windsurf',
        model: { providerId: 'custom-openai', modelId: 'gpt-5-mini' },
      },
    });
    // Empty credentials auto-fill oauth:devin; they do not switch backend to model.
    expect(readiness.ready).toBe(true);
  });
});

describe('buildCodeSearchTool execute', () => {
  it('returns the devin framing for a successful search', async () => {
    const tool = buildTool();
    const result = await tool?.execute(
      { search_term: 'where is createHandler', search_folder_absolute_uri: root },
      new AbortController().signal,
      {} as never,
    );
    expect(result && result.ok).toBe(true);
    if (result && result.ok) {
      expect(result.output).toContain('A search subagent explored the codebase');
      expect(result.output).toContain('<file path="src/app.ts" total_lines=1>');
      expect(result.output).toContain('1|export const createHandler = () => 1;');
    }
  });

  it('rejects an empty or missing search term', async () => {
    const tool = buildTool();
    const missing = await tool?.execute({ search_folder_absolute_uri: root }, new AbortController().signal, {} as never);
    expect(missing && missing.ok).toBe(false);
    if (missing && !missing.ok) {
      expect(missing.code).toBe('invalid-input');
      expect(missing.message).toContain('search_term cannot be empty');
    }
    const blank = await tool?.execute(
      { search_term: '   ', search_folder_absolute_uri: root },
      new AbortController().signal,
      {} as never,
    );
    expect(blank && blank.ok).toBe(false);
  });

  it('rejects a missing or relative search folder', async () => {
    const tool = buildTool();
    for (const value of [undefined, '', 'src', 'file:///tmp/x']) {
      const result = await tool?.execute(
        { search_term: 'q', search_folder_absolute_uri: value },
        new AbortController().signal,
        {} as never,
      );
      expect(result && result.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.code).toBe('invalid-input');
      }
    }
  });

  it('refuses a search folder outside the session workspace', async () => {
    const tool = buildTool();
    const result = await tool?.execute(
      { search_term: 'q', search_folder_absolute_uri: tmpdir() },
      new AbortController().signal,
      {} as never,
    );
    expect(result && result.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.message).toContain('must stay inside the session workspace');
    }
  });

  it('accepts a subfolder of the workspace', async () => {
    const tool = buildTool();
    const result = await tool?.execute(
      { search_term: 'q', search_folder_absolute_uri: join(root, 'src') },
      new AbortController().signal,
      {} as never,
    );
    expect(result && result.ok).toBe(true);
  });

  it('reports a subagent failure as execution-failed', async () => {
    const tool = buildTool({
      completionPort: async () => {
        throw new Error('model exploded');
      },
    });
    const result = await tool?.execute(
      { search_term: 'q', search_folder_absolute_uri: root },
      new AbortController().signal,
      {} as never,
    );
    expect(result && result.ok).toBe(false);
    if (result && !result.ok) {
      expect(result.code).toBe('execution-failed');
      expect(result.message).toContain('model exploded');
    }
  });

  it('carries no-results through as a successful tool call', async () => {
    const tool = buildTool({ completionPort: answerPort('<ANSWER></ANSWER>') });
    const result = await tool?.execute(
      { search_term: 'q', search_folder_absolute_uri: root },
      new AbortController().signal,
      {} as never,
    );
    expect(result && result.ok).toBe(true);
    if (result && result.ok) {
      expect(result.output).toContain('did not find relevant code');
      expect(result.details?.codeSearch).toMatchObject({ status: 'no-results' });
    }
  });
});

describe('resolveCodeSearchBackend subscription model', () => {
  it('is ready for mapped Grok subscription chat', () => {
    const readiness = resolveCodeSearchBackend({
      cwd: '/tmp',
      config: {
        enabled: true,
        backend: 'model',
        model: { providerId: 'xai', modelId: 'grok-4.5' },
      },
      resolveModel: () => ({
        provider: {
          id: 'xai',
          protocol: 'openai-compatible',
          name: 'Grok',
          baseUrl: 'oauth://xai',
          source: 'subscription',
          models: [{ id: 'grok-4.5' }],
        },
        modelId: 'grok-4.5',
      }),
    });
    expect(readiness.ready).toBe(true);
  });

  it('is ready for Codex OAuth the same way as any other configured chat model', () => {
    const readiness = resolveCodeSearchBackend({
      cwd: '/tmp',
      config: {
        enabled: true,
        backend: 'model',
        model: { providerId: 'openai-codex', modelId: 'gpt-5.4' },
      },
      resolveModel: () => ({
        provider: {
          id: 'openai-codex',
          protocol: 'openai-compatible',
          name: 'Codex',
          baseUrl: 'oauth://openai-codex',
          source: 'subscription',
          models: [{ id: 'gpt-5.4' }],
        },
        modelId: 'gpt-5.4',
      }),
    });
    expect(readiness.ready).toBe(true);
  });

  it('falls back to resolveModel() when no model is selected', () => {
    const readiness = resolveCodeSearchBackend({
      cwd: '/tmp',
      config: { enabled: true, backend: 'model' },
      resolveModel: (ref) => {
        expect(ref).toBeUndefined();
        return {
          provider: {
            id: 'custom-openai',
            protocol: 'openai-compatible',
            name: 'CPA',
            baseUrl: 'http://127.0.0.1:8317/v1',
            models: [{ id: 'gpt-5-mini' }],
          },
          modelId: 'gpt-5-mini',
        };
      },
    });
    expect(readiness.ready).toBe(true);
  });
});
