/** Build an in-memory Pi SessionManager from product transcript text. */

import type { Api, AssistantMessage, UserMessage } from '@earendil-works/pi-ai';
import type { NativeContextEntry, SessionSeedMessage } from '@piwin/contracts';

/**
 * Pi `appendMessage` accepts the full native Message union (assistant,
 * toolResult, …). Replayed native copies are parsed JSON of exactly those
 * shapes; the record form covers roles this module does not synthesize.
 */
type SeedablePiMessage = UserMessage | AssistantMessage | Record<string, unknown>;

type SeededSessionManager = {
  appendMessage(message: SeedablePiMessage): string;
};

type SessionManagerExport = {
  inMemory(cwd?: string): SeededSessionManager;
};

type SettingsManagerExport = {
  inMemory(settings?: Record<string, unknown>): unknown;
};

/**
 * Create a non-persisted Pi history. This deliberately uses Pi's public
 * SessionManager seam instead of writing Pi JSONL or importing Pi in product
 * packages.
 */
export function createSeededPiSessionManager(
  piModule: Record<string, unknown>,
  cwd: string,
  seedMessages: readonly SessionSeedMessage[],
): SeededSessionManager {
  const sessionManager = piModule.SessionManager as SessionManagerExport | undefined;
  if (!sessionManager || typeof sessionManager.inMemory !== 'function') {
    throw new Error('SessionManager.inMemory export missing from @earendil-works/pi-coding-agent');
  }

  const manager = sessionManager.inMemory(cwd);
  for (const message of seedMessages) {
    const nativeMessages = parseNativeEntries(message.native);
    if (nativeMessages !== undefined) {
      // Full-fidelity replay (spec: session-conversation-tree §4.4): the
      // native copies already contain tool calls, tool results, and thinking.
      for (const nativeMessage of nativeMessages) {
        manager.appendMessage(nativeMessage);
      }
      continue;
    }
    const text = message.text.trim();
    if (!text) continue;
    manager.appendMessage(toPiMessage(message, text));
  }
  return manager;
}

/**
 * Parse one seed's native entries. Any truncated or unparsable entry makes
 * the whole seed fall back to its text form — a partial native replay would
 * desynchronize tool-call/tool-result pairing inside the Pi context.
 */
function parseNativeEntries(
  entries: readonly NativeContextEntry[] | undefined,
): Record<string, unknown>[] | undefined {
  if (entries === undefined || entries.length === 0) {
    return undefined;
  }
  const parsed: Record<string, unknown>[] = [];
  for (const entry of entries) {
    if (entry.truncated === true || entry.payload.length === 0) {
      return undefined;
    }
    try {
      const value = JSON.parse(entry.payload) as unknown;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
      }
      parsed.push(value as Record<string, unknown>);
    } catch {
      return undefined;
    }
  }
  return parsed;
}

/**
 * Make Pi compact the whole seeded history, including a single short turn.
 * This setting is attached only to the ephemeral seeded session.
 */
export function createSeededPiSettingsManager(piModule: Record<string, unknown>): unknown {
  const settingsManager = piModule.SettingsManager as SettingsManagerExport | undefined;
  if (!settingsManager || typeof settingsManager.inMemory !== 'function') {
    throw new Error('SettingsManager.inMemory export missing from @earendil-works/pi-coding-agent');
  }
  return settingsManager.inMemory({
    compaction: {
      keepRecentTokens: 1,
    },
    retry: {
      enabled: false,
      maxRetries: 0,
    },
  });
}

function toPiMessage(message: SessionSeedMessage, text: string): SeedablePiMessage {
  if (message.role === 'user') {
    return {
      role: 'user',
      content: text,
      timestamp: normalizeTimestamp(message.timestamp),
    };
  }

  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions' as Api,
    provider: 'piwin-snapshot',
    model: 'session-snapshot',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: 'stop',
    timestamp: normalizeTimestamp(message.timestamp),
  };
}

function normalizeTimestamp(timestamp: number): number {
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}
