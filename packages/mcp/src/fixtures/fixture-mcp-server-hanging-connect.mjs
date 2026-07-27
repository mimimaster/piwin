#!/usr/bin/env node
/**
 * Minimal MCP stdio server that hangs during initialize.
 *
 * Reads the initial `initialize` request but never responds, simulating a
 * dead / unresponsive MCP process that causes the MCP lifecycle manager's
 * connect timeout to fire.
 *
 * Usage:
 *   node packages/mcp/src/fixtures/fixture-mcp-server-hanging-connect.mjs
 *
 * The process stays alive until stdin closes (stdin EOF or pipe error).
 */
import { createInterface } from 'node:readline';

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

  // For the initialize request, simply never respond — the lifecycle manager
  // should time out and report an error state.
  if (method === 'initialize') {
    // Hang: do not send any response.
    return;
  }

  // For any other message, also hang to avoid partial init.
});

// Keep the process alive until stdin closes.
setInterval(() => {}, 1 << 30);
