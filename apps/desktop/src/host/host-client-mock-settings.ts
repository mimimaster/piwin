import type { MockHostBackend } from './host-client-mock.js';
import type {
  HostCommand,
  HostResponse,
  SearchRoutePreviewData,
} from '@piwin/contracts';
import { buildSearchChain } from '@piwin/contracts';

export async function handleMockSettingsCommands(
  host: MockHostBackend,
  command: HostCommand,
  id: string,
): Promise<HostResponse | null> {
  switch (command.type) {
      case 'permission/resolve':
        return {
          id,
          type: 'response',
          command: 'permission/resolve',
          success: true,
          data: { requestId: command.requestId, decision: command.decision },
        };
      case 'config/get':
        return {
          id,
          type: 'response',
          command: 'config/get',
          success: true,
          data: {
            root: '~/.piwin',
            config: host.mockConfig,
          },
        };
      case 'permissions/get-rules':
        return {
          id,
          type: 'response',
          command: 'permissions/get-rules',
          success: true,
          data: {
            layer: 'user',
            rules: host.mockUserPermissionRules,
            revision: host.mockUserPermissionRulesRevision,
          },
        };
      case 'permissions/set-rules':
        host.mockUserPermissionRules = command.rules;
        host.mockUserPermissionRulesRevision = `mock-rules-${Date.now()}`;
        return {
          id,
          type: 'response',
          command: 'permissions/set-rules',
          success: true,
          data: {
            layer: 'user',
            rules: host.mockUserPermissionRules,
            revision: host.mockUserPermissionRulesRevision,
          },
        };
      // Sample catalog (46 illustrative models) so the phone model sheet has a
      // realistic list in the in-browser mock; values are not real pricing/limits.
      case 'models/configured' as never: {
        const m = (providerId: string, providerName: string, modelId: string, label: string, contextWindow: number, reasoning = true, image = false) => ({
          providerId, providerName, modelId, label, contextWindow, reasoning, protocol: providerId === 'anthropic' ? 'anthropic-compatible' : providerId === 'vertex' ? 'google-vertex' : 'openai-compatible',
          ...(reasoning ? { thinkingLevels: ['off', 'low', 'medium', 'high'] } : {}),
          input: image ? ['text', 'image'] : ['text'],
        });
        return {
          id, type: 'response', command: 'models/configured', success: true,
          data: {
            defaultProviderId: 'anthropic', defaultModelId: 'claude-sonnet-4-6',
            models: [
              m('anthropic', 'Claude', 'claude-sonnet-4-6', 'Sonnet 4.6', 200000, true, true),
              m('anthropic', 'Claude', 'claude-opus-4-1', 'Opus 4.1', 200000, true, true),
              m('anthropic', 'Claude', 'claude-haiku-4-5', 'Haiku 4.5', 200000, true, true),
              m('openai', 'OpenAI', 'gpt-5-codex', 'GPT-5 Codex', 400000),
              m('openai', 'OpenAI', 'gpt-5-mini', 'GPT-5 mini', 400000, true, true),
              m('xai', 'xAI', 'grok-4-fast', 'Grok 4 Fast', 2000000),
              m('vertex', 'Vertex', 'gemini-2.5-pro', 'Gemini 2.5 Pro', 1000000, true, true),
              m('deepseek', 'DeepSeek', 'deepseek-v3', 'V3.2', 128000, false),
              m('kiro', 'Kiro', 'kiro-default', 'default', 200000, false),
              m('anthropic', 'Claude', 'claude-sonnet-4-5', 'Sonnet 4.5', 200000, true, true),
              m('anthropic', 'Claude', 'claude-opus-4', 'Opus 4', 200000, true, true),
              m('anthropic', 'Claude', 'claude-3-7-sonnet', 'Sonnet 3.7', 200000, true, true),
              m('openai', 'OpenAI', 'gpt-5', 'GPT-5', 400000, true, true),
              m('openai', 'OpenAI', 'gpt-5-nano', 'GPT-5 nano', 400000, true, true),
              m('openai', 'OpenAI', 'gpt-4-1', 'GPT-4.1', 1000000, false, true),
              m('openai', 'OpenAI', 'o3', 'o3', 200000, true, true),
              m('openai', 'OpenAI', 'o4-mini', 'o4-mini', 200000, true, true),
              m('openai', 'OpenAI', 'gpt-oss-120b', 'gpt-oss 120B', 131000, true, false),
              m('xai', 'xAI', 'grok-4', 'Grok 4', 256000, true, true),
              m('xai', 'xAI', 'grok-code-fast', 'Grok Code Fast', 256000, true, false),
              m('xai', 'xAI', 'grok-3-mini', 'Grok 3 mini', 131000, true, false),
              m('vertex', 'Vertex', 'gemini-2.5-flash', 'Gemini 2.5 Flash', 1000000, true, true),
              m('vertex', 'Vertex', 'gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 1000000, true, true),
              m('vertex', 'Vertex', 'gemini-2.0-flash', 'Gemini 2.0 Flash', 1000000, false, true),
              m('deepseek', 'DeepSeek', 'deepseek-r1', 'R1', 128000, true, false),
              m('deepseek', 'DeepSeek', 'deepseek-v3-1', 'V3.1', 128000, true, false),
              m('moonshot', 'Moonshot', 'kimi-k2', 'Kimi K2', 256000, false, false),
              m('moonshot', 'Moonshot', 'kimi-k2-thinking', 'Kimi K2 Thinking', 256000, true, false),
              m('moonshot', 'Moonshot', 'kimi-latest', 'Kimi latest', 128000, false, true),
              m('zhipu', '智谱', 'glm-4-6', 'GLM-4.6', 200000, true, false),
              m('zhipu', '智谱', 'glm-4-5-air', 'GLM-4.5 Air', 128000, true, false),
              m('zhipu', '智谱', 'glm-4-5v', 'GLM-4.5V', 64000, true, true),
              m('qwen', '通义千问', 'qwen3-coder-plus', 'Qwen3 Coder Plus', 1000000, false, false),
              m('qwen', '通义千问', 'qwen3-max', 'Qwen3 Max', 262000, true, false),
              m('qwen', '通义千问', 'qwen3-235b', 'Qwen3 235B', 131000, true, false),
              m('qwen', '通义千问', 'qwen-vl-max', 'Qwen VL Max', 131000, false, true),
              m('openrouter', 'OpenRouter', 'or-llama-4-maverick', 'Llama 4 Maverick', 1000000, false, true),
              m('openrouter', 'OpenRouter', 'or-mistral-large', 'Mistral Large 2', 128000, false, false),
              m('openrouter', 'OpenRouter', 'or-devstral', 'Devstral Medium', 128000, false, false),
              m('openrouter', 'OpenRouter', 'or-minimax-m2', 'MiniMax M2', 204000, true, false),
              m('openrouter', 'OpenRouter', 'or-hermes-4', 'Hermes 4 405B', 131000, true, false),
              m('doubao', '豆包', 'doubao-seed-1-6', 'Seed 1.6', 256000, true, true),
              m('doubao', '豆包', 'doubao-seed-code', 'Seed Code', 256000, true, false),
              m('ollama', 'Ollama（本机）', 'ollama-qwen3-30b', 'qwen3:30b', 40000, true, false),
              m('ollama', 'Ollama（本机）', 'ollama-gpt-oss-20b', 'gpt-oss:20b', 131000, true, false),
              m('ollama', 'Ollama（本机）', 'ollama-llama3-1', 'llama3.1:8b', 131000, false, false),
            ],
          },
        } as never;
      }
      case 'settings/get':
        return {
          id,
          type: 'response',
          command: 'settings/get',
          success: true,
          data: {
            root: '~/.piwin',
            snapshot: {
              schemaVersion: 2,
              revision: host.mockSettingsRevision,
              runtimeRevision: host.mockRuntimeSettingsRevision,
              domainRevisions: {},
              config: host.mockConfig,
            },
          },
        };
      case 'web/search-route-preview': {
        const hasEnabledSources = command.input.searchSources.some((source) => source.enabled);
        const duckduckgoEnabled = command.input.searchSources.some(
          (source) => source.kind === 'duckduckgo' && source.enabled,
        );
        const hasDelegateModel = command.input.searchDelegateModel !== undefined;
        const nativeReady = hasDelegateModel;
        const policy = command.input.policy;
        const chain = buildSearchChain({
          policy,
          nativeReady,
          hasEnabledSources,
          duckduckgoEnabled,
        });
        const data: SearchRoutePreviewData = {
          route: {
            policy,
            chain,
            readiness: {
              native: {
                ready: nativeReady,
                modelTagged: nativeReady,
                adapterRequestSupported: nativeReady,
                hasDelegateModel,
                reasons: nativeReady
                  ? []
                  : ['mock host does not provide a selected native-search model'],
              },
              external: {
                ready: true,
                hasEnabledSources,
                reasons: [],
              },
            },
            issues: chain.length > 0
              ? []
              : [
                  ...(nativeReady ? [] : ['mock host does not provide a selected native-search model']),
                  'no search backend is ready for the configured policy',
                ],
          },
        };
        return {
          id,
          type: 'response',
          command: 'web/search-route-preview',
          success: true,
          data,
        };
      }
      case 'settings/apply': {
        const input = command.input;
        if (
          input.expectedRevision !== undefined &&
          input.expectedRevision !== host.mockSettingsRevision
        ) {
          return {
            id,
            type: 'response',
            command: 'settings/apply',
            success: false,
            error: 'settings-revision-conflict',
          };
        }
        let nextConfig = host.mockConfig;
        for (const mutation of input.mutations) {
          if (mutation.kind !== 'replace-domain') {
            return {
              id,
              type: 'response',
              command: 'settings/apply',
              success: false,
              error: 'unsupported mutation kind',
            };
          }
          nextConfig = {
            ...nextConfig,
            [mutation.domain]: mutation.value,
          } as import('@piwin/contracts').PiwinConfig;
        }
        host.mockConfig = nextConfig;
        host.mockSettingsRevision = `mock-settings-v${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        if (
          input.mutations.some(
            (mutation) =>
              !['desktop', 'media', 'artifact', 'automation', 'visionDelegation', 'replyWriter'].includes(
                mutation.domain,
              ),
          )
        ) {
          host.mockRuntimeSettingsRevision = `mock-runtime-settings-v${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
        }
        return {
          id,
          type: 'response',
          command: 'settings/apply',
          success: true,
          data: {
            snapshot: {
              schemaVersion: 2,
              revision: host.mockSettingsRevision,
              runtimeRevision: host.mockRuntimeSettingsRevision,
              domainRevisions: {},
              config: host.mockConfig,
            },
            changedDomains: input.mutations.map((mutation) => ({
              domain: mutation.domain,
              timing: 'new-runtime',
              runtimeSchemaChanged: true,
              immediateRestrictions: mutation.domain === 'permissions' ? ['permission-policy'] : [],
              securityTightenedImmediately: mutation.domain === 'permissions',
            })),
          },
        };
      }
      case 'secrets/set': {
        const store = host as { _mockSecrets?: Map<string, string> };
        if (!store._mockSecrets) store._mockSecrets = new Map();
        store._mockSecrets.set(command.providerId, command.secret);
        return {
          id,
          type: 'response',
          command: 'secrets/set',
          success: true,
          data: {
            providerId: command.providerId,
            apiKeyRef: `keychain:piwin-${command.providerId}`,
          },
        };
      }
      case 'secrets/get': {
        const store = host as { _mockSecrets?: Map<string, string> };
        const secret = store._mockSecrets?.get(command.providerId) ?? '';
        const keys = secret
          .split(/\r?\n/)
          .map((line: string) => line.trim())
          .filter(Boolean)
          .map((value: string, index: number) => ({
            index,
            preview: value.length > 10 ? `${value.slice(0, 6)}******${value.slice(-4)}` : '****',
          }));
        return {
          id,
          type: 'response',
          command: 'secrets/get',
          success: true,
          data: { providerId: command.providerId, keys, secret },
        };
      }
      case 'models/discover': {
        const modelsByProtocol: Record<
          import('@piwin/contracts').ModelProviderConfig['protocol'],
          import('@piwin/contracts').DiscoveredModel[]
        > = {
          'openai-compatible': [
            { id: 'deepseek-chat', label: 'DeepSeek Chat' },
            { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
            { id: 'custom-reasoning-model', label: 'Custom Reasoning Model' },
          ],
          'google-vertex': [{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }],
          'amazon-bedrock': [
            { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5' },
          ],
          'anthropic-compatible': [
            { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
            { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
          ],
          'google-gemini': [
            { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
            { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
          ],
        };
        return {
          id,
          type: 'response',
          command: 'models/discover',
          success: true,
          data: {
            providerId: command.provider.id,
            protocol: command.provider.protocol,
            models: modelsByProtocol[command.provider.protocol],
          },
        };
      }
      case 'models/test': {
        return {
          id,
          type: 'response',
          command: 'models/test',
          success: true,
          data: {
            providerId: command.provider.id,
            modelId: command.modelId,
            durationMs: 42,
          },
        };
      }
      case 'models/test-connection': {
        const modelId = command.modelId ?? command.provider.models[0]?.id;
        return {
          id,
          type: 'response',
          command: 'models/test-connection',
          success: true,
          data: modelId
            ? {
                providerId: command.provider.id,
                protocol: command.provider.protocol,
                outcome: 'chat-ok',
                method: 'model-test',
                modelId,
                durationMs: 42,
              }
            : {
                providerId: command.provider.id,
                protocol: command.provider.protocol,
                outcome: 'catalog-ok',
                method: 'discovery',
                // Mirrors the mock `models/discover` catalog size.
                modelCount: command.provider.protocol === 'openai-compatible' ? 3 : 2,
                durationMs: 42,
              },
        };
      }
      case 'models/image-test': {
        return {
          id,
          type: 'response',
          command: 'models/image-test',
          success: true,
          data: {
            providerId: command.provider.id,
            modelId: command.modelId,
            durationMs: 42,
            imageCount: 1,
            outputs: [{ mimeType: 'image/png', byteSize: 1024 }],
          },
        };
      }
      case 'models/image-catalog/search': {
        return {
          id,
          type: 'response',
          command: 'models/image-catalog/search',
          success: true,
          data: {
            entries: [],
            catalogVersion: 'mock',
          },
        };
      }
      case 'models/catalog/status': {
        return {
          id,
          type: 'response',
          command: 'models/catalog/status',
          success: true,
          data: {
            source: 'pi-bootstrap',
            catalogVersion: 'mock',
            entryCount: 0,
            imageEntryCount: 0,
          },
        };
      }
      case 'models/catalog/sync': {
        return {
          id,
          type: 'response',
          command: 'models/catalog/sync',
          success: true,
          data: {
            ok: true,
            source: 'models.dev',
            catalogVersion: 'mock',
            fetchedAt: '2026-09-21T00:00:00.000Z',
            entryCount: 1,
            imageEntryCount: 0,
          },
        };
      }
    default:
      return null;
  }
}

