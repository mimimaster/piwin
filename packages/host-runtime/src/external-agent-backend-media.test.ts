import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { listMediaLibrary } from '@piwin/media';
import { ExternalAgentBackend } from './external-agent-backend.js';
import { requireExtensionBackendLaunch } from './extension-session-backends.js';
import { installFixtureAgentAdapter } from './testing/agent-plugin-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it('attaches imported replay outputs to their tool owner and reuses the library asset on reload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'piwin-replay-media-'));
  const installed = await installFixtureAgentAdapter(root, {
    script: {
      replayEvents: [
        { type: 'agent', event: { type: 'message/start', messageId: 'owner', role: 'assistant' } },
        {
          type: 'agent',
          event: { type: 'tool/end', toolCallId: 'image', responseMessageId: 'owner', isError: false },
          media: [{ directoryId: 'images', relativePath: 'frame.png', kind: 'image', importKey: 'native:image', prompt: 'replay portrait' }],
        },
      ],
    },
  });
  const directory = join(root, '.piwin-fixture/images');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'frame.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1EAAAAASUVORK5CYII=', 'base64'));
  const backend = new ExternalAgentBackend({
    push: () => undefined,
    pendingPermissions: new Map(),
    getForegroundRunId: () => undefined,
    onSessionTitle: () => undefined,
    onSessionTransportClosed: () => undefined,
    requireInstall: (agentId) => requireExtensionBackendLaunch(root, agentId),
    createRequestId: () => 'request-1',
    piwinRoot: root,
    env: installed.env,
  });
  cleanups.push(async () => {
    await backend.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const input = {
    agentId: installed.agentId, productSessionId: 'product-1', cwd: root,
    binding: { agentId: installed.agentId, backendSessionId: 'native-1' },
    mode: 'load' as const, runtimeGenerationId: 'generation-1',
  };
  const first = await backend.openSession(input);
  cleanups.push(() => first.handle.release());
  const ended = first.replayEvents.find((event) => event.type === 'tool/end');
  expect(ended).toMatchObject({
    responseMessageId: 'owner',
    attachments: [{ kind: 'media', source: 'generated', mimeType: 'image/png' }],
  });
  await first.handle.release();
  const second = await backend.openSession({ ...input, runtimeGenerationId: 'generation-2' });
  cleanups.push(() => second.handle.release());
  expect(second.replayEvents.find((event) => event.type === 'tool/end')).toEqual(ended);
  const library = await listMediaLibrary({ mediaRoot: join(root, 'media') }, {});
  expect(library.items).toHaveLength(1);
  expect(library.items[0]).toMatchObject({ sessionId: 'product-1', prompt: 'replay portrait' });
});
