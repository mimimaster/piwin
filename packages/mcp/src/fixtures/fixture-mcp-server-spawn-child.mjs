import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], {
  stdio: 'ignore',
});
const childPidFile = process.env.PIWIN_FIXTURE_CHILD_PID_FILE;
if (childPidFile && typeof descendant.pid === 'number') {
  writeFileSync(childPidFile, String(descendant.pid), 'utf8');
}

const server = new Server(
  { name: 'piwin-fixture-mcp-spawn-child', version: '0.0.0' },
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

server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: 'pong' }],
}));

const transport = new StdioServerTransport();
await server.connect(transport);

if (process.env.PIWIN_FIXTURE_EXIT_AFTER_INIT === '1') {
  setTimeout(() => process.exit(17), 100).unref();
}
