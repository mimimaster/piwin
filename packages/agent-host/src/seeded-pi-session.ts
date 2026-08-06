/** Build an in-memory Pi SessionManager from product transcript text. */

import type { Api, AssistantMessage, UserMessage } from '@earendil-works/pi-ai';
import type { SessionSeedMessage } from '@piwin/contracts';

type SeedablePiMessage = UserMessage | AssistantMessage;

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
    const text = message.text.trim();
    if (!text) continue;
    manager.appendMessage(toPiMessage(message, text));
  }
  return manager;
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
