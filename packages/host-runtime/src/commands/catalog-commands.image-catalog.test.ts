/**
 * Regression: models/image-catalog/search must return Pi's ImagesModel catalog.
 *
 * Image Generation settings matches discovered provider models against this
 * catalog. When the IPC handler is missing, the desktop receives an unhandled
 * command / empty catalog and never shows matched image-generation models.
 */
import { describe, expect, it } from 'vitest';
import { handleCatalogCommand } from './catalog-commands.js';
import type { HostCommandContext } from './host-command-context.js';

function createMinimalContext(): HostCommandContext {
  return {
    push: () => {},
    requireSession: () => {
      throw new Error('session not needed for image catalog search');
    },
    getMcpManager: () => {
      throw new Error('mcp not needed for image catalog search');
    },
    getJobController: () => {
      throw new Error('jobs not needed for image catalog search');
    },
    todoStore: {} as HostCommandContext['todoStore'],
    petStateStore: {
      snapshot: () => ({ pet: null }),
      setBase: () => {},
    } as unknown as HostCommandContext['petStateStore'],
    runCronJob: async () => ({ ok: false }),
    pendingPermissions: new Map(),
    pendingExtensionUi: new Map(),
    rememberProjectPermission: async () => {},
    rememberSessionPermission: () => {},
    sessionPermissionOverrides: new Map(),
    setSessionPermissionOverride: () => {},
    clearSessionPermissionOverride: () => {},
  } as unknown as HostCommandContext;
}

describe('handleCatalogCommand models/image-catalog/search', () => {
  it('returns Pi image-generation catalog entries (not unhandled/null)', async () => {
    const response = await handleCatalogCommand(
      { type: 'models/image-catalog/search' },
      'req-image-catalog',
      createMinimalContext(),
    );

    expect(response).not.toBeNull();
    expect(response).toMatchObject({
      type: 'response',
      command: 'models/image-catalog/search',
      success: true,
    });
    if (!response || response.type !== 'response' || !response.success) {
      throw new Error(`expected success response, got ${JSON.stringify(response)}`);
    }

    const data = response.data as {
      entries: Array<{ modelId: string; catalogProviderId: string }>;
      catalogVersion: string;
    };
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.entries.length).toBeGreaterThan(0);
    expect(typeof data.catalogVersion).toBe('string');

    // Known Pi image models used by ImageModelSuggest matching.
    const modelIds = data.entries.map((entry) => entry.modelId);
    expect(modelIds).toEqual(
      expect.arrayContaining(['openai/gpt-image-1', 'google/gemini-3-pro-image']),
    );
  });
});
