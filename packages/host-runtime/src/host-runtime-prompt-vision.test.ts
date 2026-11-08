import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HostPush,
  PiwinConfig,
  PromptInput,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { createDefaultPiwinConfig, savePiwinConfig } from './config-store.js';
import { buildModelPromptInput } from './host-runtime-prompt.js';
import { HostRuntime } from './host-runtime.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { getPiwinMediaDir } from './paths.js';
import { sharedVisionDelegationCache } from './vision-delegation.js';

describe('vision delegation prompt failures', () => {
  const roots: string[] = [];
  const runtimes: HostRuntime[] = [];
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv('PIWIN_TEST_VISION_API_KEY', 'test-key');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    sharedVisionDelegationCache.clear();
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function createFixture(changeConfig?: (config: PiwinConfig) => void) {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-vision-prompt-'));
    roots.push(piwinRoot);
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'gateway',
        protocol: 'openai-compatible',
        name: 'Gateway',
        baseUrl: 'https://vision.test/v1',
        apiKeyEnv: 'PIWIN_TEST_VISION_API_KEY',
        models: [
          { id: 'primary', input: ['text'] },
          { id: 'vision', input: ['text', 'image'] },
        ],
      },
    ];
    config.defaultProviderId = 'gateway';
    config.defaultModelId = 'primary';
    config.visionDelegation = {
      enabled: true,
      model: { protocol: 'openai-compatible', providerId: 'gateway', modelId: 'vision' },
      cacheEnabled: false,
    };
    changeConfig?.(config);
    await savePiwinConfig(config, piwinRoot);
    const mediaRoot = getPiwinMediaDir(piwinRoot);
    await mkdir(mediaRoot, { recursive: true });
    const imagePath = join(mediaRoot, 'image.png');
    await writeFile(imagePath, Buffer.from([137, 80, 78, 71]));
    const input: PromptInput = {
      text: 'What is in this image?',
      attachments: [
        {
          id: 'image',
          kind: 'media',
          path: imagePath,
          mimeType: 'image/png',
          byteSize: 4,
          source: 'paste',
        },
      ],
    };
    const pushes: HostPush[] = [];
    const kernel = {
      options: { piwinRoot },
      push: (push: HostPush) => pushes.push(push),
    } as unknown as HostRuntimeKernel;
    return { kernel, input, pushes, piwinRoot };
  }

  it('stops preparation with a visible error when the configured vision model is rejected', async () => {
    const { kernel, input } = await createFixture();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: 'The vision model is no longer available' },
        }),
        { status: 404, statusText: 'Not Found' },
      ),
    );

    await expect(buildModelPromptInput(kernel, input)).rejects.toMatchObject({
      name: 'VisionDelegationError',
      message: expect.stringMatching(/视觉委托失败.*gateway\/vision.*404.*no longer available/),
    });
    expect(input.attachments).toHaveLength(1);
  });

  it.each([
    [
      'missing model selection',
      (config: PiwinConfig) => {
        config.visionDelegation = { enabled: true };
      },
    ],
    [
      'missing provider',
      (config: PiwinConfig) => {
        config.visionDelegation = {
          enabled: true,
          model: { protocol: 'openai-compatible', providerId: 'removed', modelId: 'vision' },
        };
      },
    ],
    [
      'disabled provider',
      (config: PiwinConfig) => {
        const provider = config.providers[0];
        if (provider) provider.enabled = false;
      },
    ],
    [
      'removed model',
      (config: PiwinConfig) => {
        config.providers[0]?.models.pop();
      },
    ],
    [
      'disabled model',
      (config: PiwinConfig) => {
        const model = config.providers[0]?.models[1];
        if (model) model.enabled = false;
      },
    ],
    [
      'missing credentials',
      () => {
        vi.stubEnv('PIWIN_TEST_VISION_API_KEY', '');
      },
    ],
  ])('rejects %s instead of returning a path-only prompt', async (_label, changeConfig) => {
    const { kernel, input } = await createFixture(changeConfig);
    await expect(buildModelPromptInput(kernel, input)).rejects.toMatchObject({
      name: 'VisionDelegationError',
      message: expect.stringContaining('图片未发送给主模型'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not send a partially described image set when a later image fails', async () => {
    const { kernel, input } = await createFixture();
    const image = input.attachments?.[0];
    if (!image) throw new Error('missing image fixture');
    input.attachments?.push({ ...image, id: 'second-image' });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'A red button.' } }],
        }),
      ),
    );
    fetchMock.mockRejectedValueOnce(new Error('Connection error'));

    await expect(buildModelPromptInput(kernel, input)).rejects.toMatchObject({
      name: 'VisionDelegationError',
      message: expect.stringContaining('Connection error'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops preparation when the delegate returns an empty description', async () => {
    const { kernel, input } = await createFixture();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [] })));
    await expect(buildModelPromptInput(kernel, input)).rejects.toMatchObject({
      name: 'VisionDelegationError',
      message: expect.stringContaining('empty description'),
    });
  });

  it('reports a delegate timeout instead of sending a path-only prompt', async () => {
    const { kernel, input } = await createFixture((config) => {
      if (config.visionDelegation) config.visionDelegation.timeoutMs = 10;
    });
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    await expect(buildModelPromptInput(kernel, input)).rejects.toMatchObject({
      name: 'VisionDelegationError',
      message: expect.stringContaining('图片未发送给主模型'),
    });
  });

  it('preserves user cancellation rather than reporting a delegation failure', async () => {
    const { kernel, input } = await createFixture();
    const controller = new AbortController();
    const stopped = new DOMException('Stopped by user', 'AbortError');
    fetchMock.mockImplementation(async () => {
      controller.abort(stopped);
      throw stopped;
    });
    await expect(buildModelPromptInput(kernel, input, controller.signal)).rejects.toBe(stopped);
  });

  it('continues to inject successful descriptions without sending image content', async () => {
    const { kernel, input } = await createFixture();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'A red button.' } }],
        }),
      ),
    );
    const prepared = await buildModelPromptInput(kernel, input);
    expect(prepared.text).toContain('[attached image — vision description]');
    expect(prepared.text).toContain('A red button.');
    expect(prepared.attachments).toBeUndefined();
  });

  it('preserves explicit delegation-off path fallback', async () => {
    const { kernel, input } = await createFixture((config) => {
      config.visionDelegation = { enabled: false };
    });
    const prepared = await buildModelPromptInput(kernel, input);
    expect(prepared.text).toContain('<attached_image path=');
    expect(prepared.attachments).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps native vision independent of an unavailable delegate', async () => {
    const { kernel, input } = await createFixture((config) => {
      config.visionDelegation = { enabled: true };
    });
    input.model = { providerId: 'gateway', modelId: 'vision' };
    const prepared = await buildModelPromptInput(kernel, input);
    expect(prepared.attachments).toEqual(input.attachments);
    expect(prepared.text).toBe(input.text);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['sdk', 'rpc'] as const)(
    'persists visible delegation errors for direct and queued turns in %s mode',
    async (mode) => {
      const { input, pushes, piwinRoot } = await createFixture();
      fetchMock.mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: 'The vision model is no longer available' },
            }),
            { status: 404, statusText: 'Not Found' },
          ),
      );
      const runtime = new HostRuntime({
        mode,
        mock: true,
        piwinRoot,
        testFixture: 'slow-first-token',
        onPush: (push) => pushes.push(push),
      });
      runtimes.push(runtime);
      const created = await runtime.handleCommand({
        type: 'session/create',
        input: { projectPath: '/tmp/vision-error' },
      });
      if (!created.success) throw new Error(created.error);
      const sessionId = (created.data as { sessionId: string }).sessionId;
      const direct = await runtime.handleCommand({ type: 'session/prompt', sessionId, input });
      if (!direct.success) throw new Error(direct.error);
      const directRunId = (direct.data as { runId: string }).runId;
      await vi.waitFor(() => {
        expect(pushes).toContainEqual(
          expect.objectContaining({
            type: 'run/terminal',
            run: expect.objectContaining({ runId: directRunId, status: 'failed' }),
          }),
        );
      });

      const first = await runtime.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text: 'A normal turn before the queued image' },
      });
      expect(first.success).toBe(true);
      const queued = await runtime.handleCommand({
        type: 'session/queued-turn-submit',
        sessionId,
        queuedTurnId: 'queued-image',
        userMessageId: 'queued-image-user',
        input,
      });
      expect(queued).toMatchObject({
        success: true,
        data: { queuedTurn: { status: 'pending' } },
      });
      const following = await runtime.handleCommand({
        type: 'session/queued-turn-submit',
        sessionId,
        queuedTurnId: 'queued-after-failure',
        userMessageId: 'queued-after-failure-user',
        input: { text: 'Continue after the failed image' },
      });
      expect(following.success).toBe(true);
      let queuedRunId: string | undefined;
      await vi.waitFor(
        () => {
          const started = pushes.find(
            (push) =>
              push.type === 'session/queued-turn-updated' &&
              push.queuedTurn.queuedTurnId === 'queued-image' &&
              push.queuedTurn.status === 'started',
          );
          if (started?.type !== 'session/queued-turn-updated')
            throw new Error('queued turn not started');
          queuedRunId = started.queuedTurn.startedRunId;
          expect(queuedRunId).toEqual(expect.any(String));
          expect(pushes).toContainEqual(
            expect.objectContaining({
              type: 'run/terminal',
              run: expect.objectContaining({ runId: queuedRunId, status: 'failed' }),
            }),
          );
        },
        { timeout: 10_000, interval: 50 },
      );

      await vi.waitFor(
        () => {
          const started = pushes.find(
            (push) =>
              push.type === 'session/queued-turn-updated' &&
              push.queuedTurn.queuedTurnId === 'queued-after-failure' &&
              push.queuedTurn.status === 'started',
          );
          if (started?.type !== 'session/queued-turn-updated')
            throw new Error('following turn not started');
          expect(pushes).toContainEqual(
            expect.objectContaining({
              type: 'run/terminal',
              run: expect.objectContaining({
                runId: started.queuedTurn.startedRunId,
                status: 'completed',
              }),
            }),
          );
        },
        { timeout: 10_000, interval: 50 },
      );

      const transcript = await runtime.handleCommand({ type: 'session/messages', sessionId });
      if (!transcript.success) throw new Error(transcript.error);
      const messages = (transcript.data as { messages: SessionTranscriptMessage[] }).messages;
      for (const runId of [directRunId, queuedRunId]) {
        expect(messages).toContainEqual(
          expect.objectContaining({
            role: 'assistant',
            status: 'error',
            runId,
            outcome: 'failed',
            failure: expect.objectContaining({
              message: expect.stringContaining('视觉委托失败（gateway/vision）'),
            }),
          }),
        );
        expect(pushes).toContainEqual(
          expect.objectContaining({
            type: 'event',
            sessionId,
            event: expect.objectContaining({
              type: 'error',
              runId,
              message: expect.stringContaining('图片未发送给主模型'),
            }),
          }),
        );
        expect(
          messages.some(
            (message) =>
              message.runId === runId && message.role === 'assistant' && message.status === 'done',
          ),
        ).toBe(false);
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
    15_000,
  );
});
