import type { MockHostBackend } from './host-client-mock.js';
import type {
  HostCommand,
  HostResponse,
  SearchRoutePreviewData,
} from '@piwin/contracts';

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
        const hasDelegateModel = command.input.searchDelegateModel !== undefined;
        const externalReady = hasDelegateModel || hasEnabledSources;
        const data: SearchRoutePreviewData = {
          route: {
            policy: command.input.policy,
            selected: externalReady ? 'external' : null,
            fallback: null,
            readiness: {
              native: {
                ready: false,
                modelTagged: false,
                adapterRequestSupported: false,
                adapterCitationSupported: false,
                reasons: ['mock host does not provide a selected native-search model'],
              },
              external: {
                ready: externalReady,
                hasEnabledSources,
                hasDelegateModel,
                reasons: externalReady ? [] : ['no enabled external search source'],
              },
            },
            issues: externalReady
              ? []
              : [
                  'no enabled external search source',
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

