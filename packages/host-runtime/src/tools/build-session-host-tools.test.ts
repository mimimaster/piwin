import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  createDefaultArtifactConfig,
  createDefaultWebConfig,
  KNOWLEDGE_TOOL_NAMES,
  type HostToolExecutionContext,
} from '@piwin/contracts';
import { createFolderRag } from '@piwin/doc-rag';
import { createNoteStore } from '@piwin/notes';
import { createDefaultPiwinConfig } from '../config-store.js';
import type { SecretResolver } from '../secret-resolver.js';
import { buildSessionHostTools } from './build-session-host-tools.js';

describe('buildSessionHostTools artifact_instructions', () => {
  it('composes the tool when Artifact is enabled and omits it when disabled', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-artifact-compose-'));
    try {
      const enabled = await buildSessionHostTools({
        sessionId: 'session-test',
        piwinRoot: rootDir,
        config: createDefaultPiwinConfig(),
      });
      expect(enabled.some((tool) => tool.descriptor.name === ARTIFACT_INSTRUCTIONS_TOOL_NAME)).toBe(
        true,
      );

      const disabled = await buildSessionHostTools({
        sessionId: 'session-test',
        piwinRoot: rootDir,
        config: {
          ...createDefaultPiwinConfig(),
          artifact: { ...createDefaultArtifactConfig(), enabled: false },
        },
      });
      expect(
        disabled.some((tool) => tool.descriptor.name === ARTIFACT_INSTRUCTIONS_TOOL_NAME),
      ).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('registers knowledge_* tools and omits note_search/list/read', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-kb-compose-'));
    const rag = createFolderRag({ piwinRoot: rootDir });
    const store = createNoteStore({ piwinRoot: rootDir });
    try {
      const tools = await buildSessionHostTools({
        sessionId: 'session-kb',
        piwinRoot: rootDir,
        config: createDefaultPiwinConfig(),
        getFolderRag: async () => rag,
        getNotesServices: async () => ({ store }),
      });
      const names = tools.map((tool) => tool.descriptor.name);
      expect(names).toEqual(
        expect.arrayContaining([
          KNOWLEDGE_TOOL_NAMES.list,
          KNOWLEDGE_TOOL_NAMES.search,
          KNOWLEDGE_TOOL_NAMES.read,
          'note_write',
          'note_update',
          'note_delete',
        ]),
      );
      expect(names).not.toContain('note_search');
      expect(names).not.toContain('note_list');
      expect(names).not.toContain('note_read');
      expect(
        tools
          .filter((tool) =>
            (Object.values(KNOWLEDGE_TOOL_NAMES) as string[]).includes(tool.descriptor.name),
          )
          .every((tool) => tool.permissionSpec.readOnly === true),
      ).toBe(true);
    } finally {
      rag.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('buildSessionHostTools web_search floor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls DuckDuckGo when the model has no native search and the switch is off', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-web-ddg-floor-'));
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      (async (input: unknown) => {
        urls.push(String(input));
        return new Response('{"Results":[],"RelatedTopics":[]}', { status: 200 });
      }) as typeof fetch,
    );
    const web = {
      ...createDefaultWebConfig(),
      searchSources: [{ id: 'duckduckgo' as const, kind: 'duckduckgo' as const, enabled: false }],
      searchRoutePolicy: 'native-first' as const,
    };
    try {
      const tools = await buildSessionHostTools({
        sessionId: 'session-ddg-floor',
        piwinRoot: rootDir,
        model: {
          protocol: 'google-gemini',
          providerId: 'gemini',
          modelId: 'gemini-flash',
        },
        config: {
          ...createDefaultPiwinConfig(),
          providers: [
            {
              id: 'gemini',
              protocol: 'google-gemini',
              name: 'Gemini',
              baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
              models: [{ id: 'gemini-flash', capabilities: ['chat'] }],
            },
          ],
          web,
        },
      });
      const search = tools.find((tool) => tool.descriptor.name === 'web_search');
      if (!search) {
        throw new Error('web_search missing');
      }
      const context: HostToolExecutionContext = {
        sessionId: 'session-ddg-floor',
        runtimeGenerationId: 'generation-1',
        runId: 'run-1',
        toolName: 'web_search',
      };
      const result = await search.execute({ query: 'piwin' }, new AbortController().signal, context);
      if (!result.ok) {
        throw new Error(result.message);
      }
      expect(urls.some((url) => url.includes('duckduckgo.com'))).toBe(true);
      expect(web.searchSources[0]?.enabled).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('buildSessionHostTools web_search credentials', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands oauth:devin to the Devin search source at execute time', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-web-devin-compose-'));
    const posted: Array<{ url: string; apiKey: string }> = [];
    vi.stubGlobal(
      'fetch',
      (async (input: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          metadata?: { apiKey?: string };
        };
        posted.push({ url: String(input), apiKey: body.metadata?.apiKey ?? '' });
        return new Response(
          JSON.stringify({
            results: [{ title: 'Piwin', url: 'https://example.com/piwin', snippet: 'ok' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch,
    );
    try {
      const tools = await buildSessionHostTools({
        sessionId: 'session-devin-search',
        piwinRoot: rootDir,
        config: {
          ...createDefaultPiwinConfig(),
          web: {
            ...createDefaultWebConfig(),
            searchRoutePolicy: 'external-first',
            searchSources: [
              { id: 'devin', kind: 'devin', enabled: true, apiKeyRef: 'oauth:devin' },
            ],
          },
        },
        secretResolver: {
          readSecretByRef: async (ref: string) =>
            ref === 'oauth:devin' ? 'devin-session-token$jwt' : null,
        } as unknown as SecretResolver,
      });
      const search = tools.find((tool) => tool.descriptor.name === 'web_search');
      if (!search) {
        throw new Error('web_search missing');
      }
      const context: HostToolExecutionContext = {
        sessionId: 'session-devin-search',
        runtimeGenerationId: 'generation-1',
        runId: 'run-1',
        toolName: 'web_search',
      };
      const result = await search.execute(
        { query: 'piwin' },
        new AbortController().signal,
        context,
      );
      if (!result.ok) {
        throw new Error(result.message);
      }
      expect(posted[0]?.apiKey).toBe('devin-session-token$jwt');
      expect(posted[0]?.url).toContain('GetWebSearchResults');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('buildSessionHostTools web_image composition', () => {
  it('registers web_image next to the web tools and drops it when web is disabled', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-web-image-compose-'));
    try {
      const enabled = await buildSessionHostTools({
        sessionId: 'session-web-image',
        piwinRoot: rootDir,
        config: createDefaultPiwinConfig(),
      });
      const enabledNames = enabled.map((tool) => tool.descriptor.name);
      expect(enabledNames).toContain('web_fetch');
      expect(enabledNames).toContain('web_image');
      expect(enabled.find((tool) => tool.descriptor.name === 'web_image')?.family).toBe('web-fetch');

      const { web: _web, ...withoutWeb } = createDefaultPiwinConfig();
      const disabled = await buildSessionHostTools({
        sessionId: 'session-web-image',
        piwinRoot: rootDir,
        config: withoutWeb,
      });
      expect(disabled.some((tool) => tool.descriptor.name === 'web_image')).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
