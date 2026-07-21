/**
 * Spec-compliant MCP stdio server (Content-Length framing) via official SDK.
 * Used to prove OfficialMcpStdioClient + auto default path.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'piwin-fixture-mcp-official', version: '0.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ping',
      description: 'Return pong',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  return {
    content: [
      {
        type: 'text',
        text: toolName === 'ping' ? 'pong' : `unknown:${toolName}`,
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
