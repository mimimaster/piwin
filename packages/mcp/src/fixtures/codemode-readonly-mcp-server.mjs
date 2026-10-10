/**
 * Local MCP stdio server for the read-only Codemode harness.
 * Not a remote server. Annotations and structured results are explicit.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'piwin-codemode-mcp', version: '0.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'rows',
      description: 'Return structured rows',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'broken',
      description: 'Return isError',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'hang',
      description: 'Wait until aborted',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    {
      name: 'mutate',
      description: 'Unhinted mutating tool',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const name = request.params.name;
  if (name === 'hang') {
    await new Promise((resolve, reject) => {
      const signal = extra.signal;
      if (signal?.aborted) {
        reject(new Error('aborted'));
        return;
      }
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  }
  if (name === 'broken') {
    return {
      content: [{ type: 'text', text: 'upstream failed' }],
      structuredContent: { reason: 'bad-row' },
      isError: true,
    };
  }
  if (name === 'mutate') {
    return {
      content: [{ type: 'text', text: 'mutated' }],
      structuredContent: { mutated: true },
      isError: false,
    };
  }
  return {
    content: [{ type: 'text', text: 'rows-text' }],
    structuredContent: { rows: [{ id: 2 }, { id: 1 }] },
    isError: false,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
