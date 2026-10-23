import type { PiwinConfig } from '@piwin/contracts';
import { asRecord } from './config-store-primitives.js';

/**
 * Foreign spellings of piwin thinking levels that appear in hand-written or
 * tool-generated configs. OpenAI-style catalogs (and proxies that mirror their
 * `reasoning_levels`) call "no reasoning" `none`; piwin's level is `off`.
 */
const THINKING_LEVEL_ALIASES: Readonly<Record<string, string>> = {
  none: 'off',
};

/**
 * Normalize provider entries read from disk. Providers otherwise pass through
 * untouched — validation stays the save-time authority — but alias spellings are
 * folded so one externally written value cannot block every later settings save.
 */
export function normalizeProviders(value: unknown): PiwinConfig['providers'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((provider: unknown) => {
    const record = asRecord(provider);
    if (!record || !Array.isArray(record.models)) {
      return provider;
    }
    return { ...record, models: record.models.map(normalizeModelThinkingLevels) };
  }) as PiwinConfig['providers'];
}

function normalizeModelThinkingLevels(model: unknown): unknown {
  const record = asRecord(model);
  if (!record) {
    return model;
  }
  const next: Record<string, unknown> = { ...record };
  if (Array.isArray(record.thinkingLevels)) {
    // Fold aliases, then drop duplicates an alias may create (`none` + `off`).
    const seen = new Set<unknown>();
    next.thinkingLevels = record.thinkingLevels.map(resolveThinkingLevelAlias).filter((level) => {
      if (seen.has(level)) {
        return false;
      }
      seen.add(level);
      return true;
    });
  }
  if (record.thinkingLevel !== undefined) {
    next.thinkingLevel = resolveThinkingLevelAlias(record.thinkingLevel);
  }
  return next;
}

function resolveThinkingLevelAlias(level: unknown): unknown {
  return typeof level === 'string' ? (THINKING_LEVEL_ALIASES[level] ?? level) : level;
}
