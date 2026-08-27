import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type OpenAiSseScenario =
  | 'thinking-only-stop'
  | 'text-stop'
  | 'missing-finish'
  | 'keep-alive-stall'
  | 'delayed-tool-continuation';

export type OpenAiSseFixture = {
  baseUrl: string;
  close: () => Promise<void>;
  /** Release a held second request used by delayed-tool-continuation. */
  releaseHeldRequest: () => void;
};

type ChatChunk = {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Record<string, unknown>;
    finish_reason: string | null;
  }>;
};

const MODEL_ID = 'fixture-model';
const COMPLETION_ID = 'chatcmpl-fixture';

/**
 * Local OpenAI-compatible SSE server for characterizing Pi 0.84.2
 * openai-completions streams. No credentials or prompt bodies are stored.
 */
export async function startOpenAiSseFixture(scenario: OpenAiSseScenario): Promise<OpenAiSseFixture> {
  let requestCount = 0;
  let heldResponse: ServerResponse | undefined;
  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  let releaseHeld: (() => void) | undefined;

  const server = createServer((request, response) => {
    void drainRequest(request).then(() => {
      requestCount += 1;
      writeSseHeaders(response);
      playScenario(scenario, requestCount, response, {
        hold: (next) => {
          heldResponse = response;
          releaseHeld = next;
        },
        startKeepAlive: () => {
          keepAliveTimer = setInterval(() => {
            if (!response.writableEnded) {
              response.write(': keep-alive\n\n');
            }
          }, 40);
        },
      });
    });
  });

  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('OpenAI SSE fixture did not bind a TCP port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    releaseHeldRequest: () => {
      releaseHeld?.();
    },
    close: async () => {
      if (keepAliveTimer !== undefined) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = undefined;
      }
      if (heldResponse && !heldResponse.writableEnded) {
        heldResponse.destroy();
      }
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      await closeServer(server);
    },
  };
}

function playScenario(
  scenario: OpenAiSseScenario,
  requestCount: number,
  response: ServerResponse,
  hooks: {
    hold: (release: () => void) => void;
    startKeepAlive: () => void;
  },
): void {
  switch (scenario) {
    case 'thinking-only-stop':
      writeChunk(response, {
        delta: { role: 'assistant', reasoning_content: 'weighing a short plan' },
        finishReason: null,
      });
      writeChunk(response, { delta: {}, finishReason: 'stop' });
      writeDone(response);
      break;
    case 'text-stop':
      writeChunk(response, { delta: { role: 'assistant', content: 'Done.' }, finishReason: null });
      writeChunk(response, { delta: {}, finishReason: 'stop' });
      writeDone(response);
      break;
    case 'missing-finish':
      writeChunk(response, { delta: { role: 'assistant', content: 'partial' }, finishReason: null });
      response.end();
      break;
    case 'keep-alive-stall':
      writeChunk(response, { delta: { role: 'assistant', content: 'hello' }, finishReason: null });
      hooks.startKeepAlive();
      break;
    case 'delayed-tool-continuation':
      if (requestCount === 1) {
        writeChunk(response, {
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'tool-1',
                type: 'function',
                function: { name: 'read', arguments: '{"path":"README.md"}' },
              },
            ],
          },
          finishReason: null,
        });
        writeChunk(response, { delta: {}, finishReason: 'tool_calls' });
        writeDone(response);
        return;
      }
      hooks.hold(() => {
        if (response.writableEnded) return;
        writeChunk(response, {
          delta: { role: 'assistant', content: 'Read complete.' },
          finishReason: null,
        });
        writeChunk(response, { delta: {}, finishReason: 'stop' });
        writeDone(response);
      });
      break;
  }
}

function writeSseHeaders(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
}

function writeChunk(
  response: ServerResponse,
  input: { delta: Record<string, unknown>; finishReason: string | null },
): void {
  const chunk: ChatChunk = {
    id: COMPLETION_ID,
    object: 'chat.completion.chunk',
    created: 1,
    model: MODEL_ID,
    choices: [{ index: 0, delta: input.delta, finish_reason: input.finishReason }],
  };
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function writeDone(response: ServerResponse): void {
  response.write('data: [DONE]\n\n');
  response.end();
}

async function drainRequest(request: IncomingMessage): Promise<void> {
  for await (const _chunk of request) {
    // Body is discarded. Fixtures must never persist prompt text.
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
