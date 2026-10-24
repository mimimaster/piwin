import type { McpOwnedProcess, McpTransportClient } from './mcp-transport.js';

/** Close helpers for the lifecycle manager: cleanup is best effort, never a second failure path. */

export async function safeCloseOwnedProcess(ownedProcess: McpOwnedProcess): Promise<void> {
  try {
    await ownedProcess.close();
  } catch {
    // The supervisor has already waited for the transport's close boundary.
  }
}

export async function safeClose(client: McpTransportClient | null): Promise<void> {
  if (!client) {
    return;
  }
  try {
    await client.close();
  } catch {
    // Cleanup is best effort; the process owner remains the primary boundary.
  }
}

export async function ignoreRejection(promise: Promise<void>): Promise<void> {
  try {
    await promise;
  } catch {
    // The initiating operation already recorded the failure on its entry.
  }
}
