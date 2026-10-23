import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { connectMcpServer } from './mcp-client.js';

type Fixture = { url: string; authorizations: string[]; close: () => Promise<void> };

function createToolServer(): Server {
  const server = new Server({ name: 'remote-fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Echo the input',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        annotations: { readOnlyHint: true },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text', text: `echo:${String(request.params.arguments?.text ?? '')}` }],
  }));
  return server;
}

async function listen(
  handler: (request: IncomingMessage, response: import('node:http').ServerResponse) => void,
  path: string,
  authorizations: string[],
): Promise<Fixture> {
  const http: HttpServer = createServer((request, response) => {
    if (typeof request.headers.authorization === 'string') {
      authorizations.push(request.headers.authorization);
    }
    handler(request, response);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${path}`,
    authorizations,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}

async function startStreamableFixture(): Promise<Fixture> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  // SDK transports vs its Transport interface under exactOptionalPropertyTypes.
  await createToolServer().connect(transport as Transport);
  return listen((request, response) => void transport.handleRequest(request, response), '/mcp', []);
}

/** Legacy HTTP+SSE only: POST to the SSE endpoint is refused, as on old servers. */
async function startSseFixture(): Promise<Fixture> {
  const sessions = new Map<string, SSEServerTransport>();
  return listen(
    (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/sse' && request.method === 'GET') {
        const transport = new SSEServerTransport('/messages', response);
        sessions.set(transport.sessionId, transport);
        void createToolServer().connect(transport);
        return;
      }
      if (url.pathname === '/messages' && request.method === 'POST') {
        const transport = sessions.get(url.searchParams.get('sessionId') ?? '');
        if (transport) {
          void transport.handlePostMessage(request, response);
          return;
        }
      }
      response.writeHead(405).end();
    },
    '/sse',
    [],
  );
}

describe('remote MCP servers', () => {
  const fixtures: Fixture[] = [];
  afterEach(async () => {
    await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
    delete process.env.PIWIN_TEST_MCP_TOKEN;
  });

  it('lists and calls tools over Streamable HTTP with expanded headers', async () => {
    const fixture = await startStreamableFixture();
    fixtures.push(fixture);
    process.env.PIWIN_TEST_MCP_TOKEN = 'secret-token';
    const client = await connectMcpServer('remote', {
      type: 'http',
      url: fixture.url,
      headers: { Authorization: 'Bearer ${PIWIN_TEST_MCP_TOKEN}' },
    });
    try {
      expect(client.pid).toBeUndefined();
      const tools = await client.listTools();
      expect(tools).toEqual([
        expect.objectContaining({ name: 'echo', readOnlyHint: true }),
      ]);
      expect(await client.callTool('echo', { text: 'hi' })).toMatchObject({
        content: [{ type: 'text', text: 'echo:hi' }],
      });
      expect(fixture.authorizations).toContain('Bearer secret-token');
    } finally {
      await client.close();
    }
  });

  it('falls back to legacy SSE when the server refuses Streamable HTTP', async () => {
    const fixture = await startSseFixture();
    fixtures.push(fixture);
    const client = await connectMcpServer('legacy', {
      url: fixture.url,
      headers: { Authorization: 'Bearer legacy' },
    });
    try {
      expect((await client.listTools()).map((tool) => tool.name)).toEqual(['echo']);
      expect(await client.callTool('echo', { text: 'old' })).toMatchObject({
        content: [{ type: 'text', text: 'echo:old' }],
      });
      // The EventSource GET and the message POSTs both carry the header.
      expect(fixture.authorizations.filter((value) => value === 'Bearer legacy').length).toBeGreaterThan(1);
    } finally {
      await client.close();
    }
  });

  it('does not fall back when the type pins Streamable HTTP', async () => {
    const fixture = await startSseFixture();
    fixtures.push(fixture);
    await expect(connectMcpServer('pinned', { type: 'http', url: fixture.url })).rejects.toThrow(
      /MCP connect failed for pinned at http:\/\/127\.0\.0\.1:\d+\/sse/,
    );
  });

  it('reports an unreachable server without leaking the query string', async () => {
    await expect(
      connectMcpServer('gone', { type: 'http', url: 'http://127.0.0.1:9/mcp?token=hidden' }),
    ).rejects.toThrow(/^(?!.*hidden).*MCP connect failed for gone/);
  });
});
