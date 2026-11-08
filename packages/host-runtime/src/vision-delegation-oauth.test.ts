import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostPush, PromptInput } from '@piwin/contracts';
import type { HostCommandContext } from './commands/host-command-context.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { createDefaultPiwinConfig, savePiwinConfig } from './config-store.js';
import { handleCatalogCommand } from './commands/catalog-commands.js';
import { buildModelPromptInput } from './host-runtime-prompt.js';
import { persistAndInspectBrowserScreenshot } from './browser-screenshot-inspect.js';
import { sharedVisionDelegationCache } from './vision-delegation.js';

const completeVision = vi.hoisted(() => vi.fn());
const readExtensions = vi.hoisted(() => vi.fn());
vi.mock('./subscription-extension-providers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./subscription-extension-providers.js')>()),
  readSubscriptionExtensionProviders: readExtensions,
}));
vi.mock('@piwin/agent-host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@piwin/agent-host')>()),
  completeModelVision: completeVision,
}));

describe('OAuth vision delegation', () => {
  let root: string;
  let imagePath: string;
  let config: ReturnType<typeof createDefaultPiwinConfig>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'piwin-vision-oauth-'));
    await mkdir(join(root, 'media'), { recursive: true });
    imagePath = join(root, 'media', 'image.png');
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71]));
    config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'text',
        name: 'Text',
        protocol: 'openai-compatible',
        baseUrl: 'http://localhost',
        models: [{ id: 'text', input: ['text'] }],
      },
      {
        id: 'xai',
        name: 'Grok',
        source: 'subscription',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        models: [{ id: 'grok-vision', input: ['text', 'image'] }],
      },
    ];
    config.defaultProviderId = 'text';
    config.defaultModelId = 'text';
    config.visionDelegation = {
      enabled: true,
      model: { providerId: 'xai', modelId: 'grok-vision', protocol: 'openai-compatible' },
      cacheEnabled: false,
    };
    await savePiwinConfig(config, root);
    completeVision.mockReset().mockResolvedValue('A sign-in screen');
    readExtensions.mockReset().mockResolvedValue([]);
    sharedVisionDelegationCache.clear();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function expectPiCall() {
    expect(completeVision).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { providerId: 'xai', modelId: 'grok-vision' },
        mimeType: expect.stringMatching(/^image\//),
        imageBase64: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
      expect.objectContaining({ agentDir: join(root, 'pi-agent') }),
    );
  }

  it('tests a subscription model from settings without asking for an API key', async () => {
    const result = await handleCatalogCommand(
      { type: 'vision/delegate', input: { imagePath, mimeType: 'image/png' } },
      undefined,
      { piwinRoot: root } as HostCommandContext,
    );
    expect(result).toMatchObject({ success: true, data: { description: 'A sign-in screen' } });
    expectPiCall();
  });

  it('injects a subscription vision description into a text-only prompt', async () => {
    const input: PromptInput = {
      text: 'Inspect',
      attachments: [
        {
          id: 'img',
          kind: 'media',
          path: imagePath,
          mimeType: 'image/png',
          byteSize: 4,
          source: 'paste',
        },
      ],
    };
    const kernel = {
      options: { piwinRoot: root },
      push: (_push: HostPush) => {},
    } as unknown as HostRuntimeKernel;
    const result = await buildModelPromptInput(kernel, input);
    expect(result.text).toContain('A sign-in screen');
    expect(result.attachments ?? []).toEqual([]);
    expectPiCall();
  });

  it('uses the same Host account for browser screenshot inspection', async () => {
    const result = await persistAndInspectBrowserScreenshot({
      jpegBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      width: 1,
      height: 1,
      sessionId: 'session',
      mediaRoot: join(root, 'media'),
      piwinRoot: root,
      config,
    });
    expect(result.output.inspect).toMatchObject({ status: 'ok', description: 'A sign-in screen' });
    expectPiCall();
  });

  it('loads only the selected enabled OAuth extension', async () => {
    const selected = { providerId: 'acme', entryPath: '/extensions/acme/index.ts' };
    readExtensions.mockResolvedValue([
      selected,
      { providerId: 'other', entryPath: '/extensions/other/index.ts' },
    ]);
    config.providers[1] = {
      id: 'acme',
      name: 'Acme',
      source: 'subscription',
      protocol: 'openai-compatible',
      baseUrl: 'oauth://acme',
      models: [{ id: 'vision', input: ['text', 'image'] }],
    };
    config.visionDelegation = {
      enabled: true,
      model: { providerId: 'acme', modelId: 'vision', protocol: 'openai-compatible' },
      cacheEnabled: false,
    };
    await savePiwinConfig(config, root);
    const result = await handleCatalogCommand(
      { type: 'vision/delegate', input: { imagePath, mimeType: 'image/png' } },
      undefined,
      { piwinRoot: root } as HostCommandContext,
    );
    expect(result).toMatchObject({ success: true });
    expect(readExtensions).toHaveBeenCalledWith(root);
    expect(completeVision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ extensionProviders: [selected] }),
    );
  });

  it('propagates cancellation to the subscription completion', async () => {
    const controller = new AbortController();
    completeVision.mockImplementation(async (input: { signal: AbortSignal }) => {
      controller.abort();
      input.signal.throwIfAborted();
      return 'unreachable';
    });
    const input: PromptInput = {
      text: 'Inspect',
      attachments: [
        {
          id: 'img',
          kind: 'media',
          path: imagePath,
          mimeType: 'image/png',
          byteSize: 4,
          source: 'paste',
        },
      ],
    };
    const kernel = {
      options: { piwinRoot: root },
      push: (_push: HostPush) => {},
    } as unknown as HostRuntimeKernel;
    await expect(buildModelPromptInput(kernel, input, controller.signal)).rejects.toBeDefined();
    expect(completeVision).toHaveBeenCalledOnce();
  });
});
