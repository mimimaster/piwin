import { afterEach, describe, expect, it } from 'vitest';
import {
  encodeTokensToCompact,
  type HighlightWorkerRequest,
  type HighlightWorkerResponse,
} from './highlight-protocol';
import {
  HighlightClient,
  type HighlightWorkerPort,
} from './highlight-client';

function createFakeWorker(options?: {
  delayMs?: number;
  onPost?: (request: HighlightWorkerRequest) => void;
}): HighlightWorkerPort & { inflight: number } {
  const listeners = new Set<(event: MessageEvent<HighlightWorkerResponse>) => void>();
  const port: HighlightWorkerPort & { inflight: number } = {
    inflight: 0,
    postMessage(request: HighlightWorkerRequest): void {
      port.inflight += 1;
      options?.onPost?.(request);
      const respond = (): void => {
        port.inflight -= 1;
        const { palette, runs } = encodeTokensToCompact([
          [{ content: request.code, color: '#79c0ff', offset: 0 }],
        ]);
        const response: HighlightWorkerResponse = {
          requestId: request.requestId,
          sourceHash: request.sourceHash,
          lineStart: 0,
          lineEnd: 1,
          palette,
          runs,
        };
        for (const listener of listeners) {
          listener({ data: response } as MessageEvent<HighlightWorkerResponse>);
        }
      };
      if (options?.delayMs && options.delayMs > 0) {
        setTimeout(respond, options.delayMs);
        return;
      }
      queueMicrotask(respond);
    },
    addEventListener(
      _type: string,
      listener: (event: MessageEvent<HighlightWorkerResponse>) => void,
    ): void {
      listeners.add(listener);
    },
    removeEventListener(
      _type: string,
      listener: (event: MessageEvent<HighlightWorkerResponse>) => void,
    ): void {
      listeners.delete(listener);
    },
  };
  return port;
}

describe('HighlightClient', () => {
  const clients: HighlightClient[] = [];

  afterEach(() => {
    for (const client of clients) {
      client.dispose();
    }
    clients.length = 0;
  });

  function createClient(port: HighlightWorkerPort): HighlightClient {
    const client = new HighlightClient({
      createWorker: () => port,
      maxInFlight: 2,
    });
    clients.push(client);
    return client;
  }

  it('round-trips tokens through the compact worker protocol', async () => {
    const client = createClient(createFakeWorker());
    const lines = await client.highlight({
      code: 'const value = 1;',
      language: 'typescript',
      theme: 'github-dark',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.[0]?.content).toBe('const value = 1;');
    expect(lines[0]?.[0]?.color).toBe('#79c0ff');
  });

  it('queues work beyond the in-flight cap instead of posting immediately', async () => {
    const posted: string[] = [];
    const port = createFakeWorker({
      delayMs: 20,
      onPost: (request) => posted.push(request.code),
    });
    const client = createClient(port);

    const first = client.highlight({
      code: 'one',
      language: 'typescript',
      theme: 'github-dark',
    });
    const second = client.highlight({
      code: 'two',
      language: 'typescript',
      theme: 'github-dark',
    });
    const third = client.highlight({
      code: 'three',
      language: 'typescript',
      theme: 'github-dark',
    });

    expect(posted).toEqual(['one', 'two']);
    expect(port.inflight).toBe(2);

    await Promise.all([first, second, third]);
    expect(posted).toEqual(['one', 'two', 'three']);
  });

  it('cancelAll rejects queued and in-flight requests', async () => {
    const port = createFakeWorker({ delayMs: 30 });
    const client = createClient(port);
    const pending = [
      client.highlight({ code: 'a', language: 'typescript', theme: 'github-dark' }),
      client.highlight({ code: 'b', language: 'typescript', theme: 'github-dark' }),
      client.highlight({ code: 'c', language: 'typescript', theme: 'github-dark' }),
    ];
    client.cancelAll();
    await expect(Promise.all(pending)).rejects.toThrow(/cancelled/i);
  });
});
