/**
 * Minimal long-lived MCP stdio server using newline-delimited JSON-RPC.
 * Compatible with handcrafted client only (not Content-Length official transport).
 */
import { createInterface } from 'node:readline';

const tools = [
  {
    name: 'ping',
    description: 'Return pong',
    inputSchema: { type: 'object', properties: {} },
  },
];

const lineReader = createInterface({ input: process.stdin, crlfDelay: Infinity });

lineReader.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (!message || typeof message !== 'object') {
    return;
  }
  const method = typeof message.method === 'string' ? message.method : '';
  const id = message.id;

  if (method === 'initialize') {
    writeResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'piwin-fixture-mcp-ndjson', version: '0.0.0' },
    });
    return;
  }

  if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
    return;
  }

  if (method === 'tools/list') {
    writeResult(id, { tools });
    return;
  }

  if (method === 'tools/call') {
    const params = message.params && typeof message.params === 'object' ? message.params : {};
    const toolName = typeof params.name === 'string' ? params.name : '';
    writeResult(id, {
      content: [{ type: 'text', text: toolName === 'ping' ? 'pong' : `unknown:${toolName}` }],
    });
    return;
  }

  if (id !== undefined && id !== null) {
    writeResult(id, {});
  }
});

setInterval(() => {}, 1 << 30);

function writeResult(id, result) {
  if (id === undefined || id === null) {
    return;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}
