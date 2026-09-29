import { describe, expect, it } from 'vitest';
import { parseWorkerFrame } from '../rpc-sdk-worker-protocol.js';
import { relayExtensionUiPublish } from './parent-extension-ui-relay.js';
import { WorkerExtensionUiChannel } from './worker-extension-ui-channel.js';

const context = { sessionId: 'sess-1', runtimeGenerationId: 'gen-1' };

describe('WorkerExtensionUiChannel', () => {
  it('sends surface updates as one-way frames the parent parses and relays', () => {
    const frames: unknown[] = [];
    const channel = new WorkerExtensionUiChannel({
      sendFrame: (frame) => frames.push(frame),
      resolveContext: () => ({ ...context, runId: 'run-1' }),
    });
    channel.createPort('sess-1').publish?.({ kind: 'status', key: 'git', text: 'main' });

    expect(frames).toEqual([
      {
        type: 'extension-ui-publish',
        context: { ...context, runId: 'run-1' },
        update: { kind: 'status', key: 'git', text: 'main' },
      },
    ]);
    const parsed = parseWorkerFrame(JSON.stringify(frames[0]));
    expect(parsed?.type).toBe('extension-ui-publish');
    const relayed: unknown[] = [];
    if (parsed?.type === 'extension-ui-publish') {
      relayExtensionUiPublish(parsed, (publication) => relayed.push(publication));
    }
    expect(relayed).toEqual([
      {
        sessionId: 'sess-1',
        runtimeGenerationId: 'gen-1',
        update: { kind: 'status', key: 'git', text: 'main' },
      },
    ]);
  });

  it('rejects open dialogs when their session is dropped', async () => {
    const channel = new WorkerExtensionUiChannel({
      sendFrame: () => undefined,
      resolveContext: () => context,
    });
    const pending = channel
      .createPort('sess-1')
      .request({ requestId: 'r', kind: 'confirm', title: 'Proceed?' }, new AbortController().signal);
    channel.rejectSession('sess-1', new Error('session dropped: sess-1'));
    await expect(pending).rejects.toThrow('session dropped');
  });
});
