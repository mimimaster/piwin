import type {
  PromptInput,
  SessionSummary,
  SessionTranscriptMessage,
  ThemeManifest,
  UsageBucket,
  UsageCallLog,
  UsageRollup,
} from '@piwin/contracts';
import {
  QUEUED_TURN_MAX_TEXT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
} from '@piwin/contracts';
import { createMockSessionTranscriptPage } from './mock-session-transcript-page';
import {
  PIWIN_APPEARANCE_INK_WASH,
  PIWIN_APPEARANCE_INKSTONE_INK,
  PIWIN_APPEARANCE_INKSTONE_PAPER,
  migrateThemeId,
} from './appearance-tokens';

export type MockBuiltinThemeId =
  | 'piwin-inkstone'
  | 'piwin-ink-wash'
  | 'piwin-inkstone-paper'
  | 'piwin-inkstone-ink';

export function resolveMockThemeId(themeId: string): MockBuiltinThemeId {
  const migrated = migrateThemeId(themeId);
  if (
    migrated === 'piwin-inkstone-paper' ||
    migrated === 'piwin-inkstone-ink' ||
    migrated === 'piwin-ink-wash' ||
    migrated === 'piwin-inkstone'
  ) {
    return migrated;
  }
  return 'piwin-inkstone-ink';
}

export function mockThemeManifest(themeId: MockBuiltinThemeId): ThemeManifest {
  switch (themeId) {
    case 'piwin-ink-wash':
      return PIWIN_APPEARANCE_INK_WASH;
    case 'piwin-inkstone-paper':
      return PIWIN_APPEARANCE_INKSTONE_PAPER;
    case 'piwin-inkstone':
      return PIWIN_APPEARANCE_INKSTONE_PAPER;
    case 'piwin-inkstone-ink':
      return PIWIN_APPEARANCE_INKSTONE_INK;
    default:
      return PIWIN_APPEARANCE_INKSTONE_INK;
  }
}

/**
 * In-process deterministic host for Vite/browser e2e.
 * Owns mock session/transcript/MCP state only.
 */

export function createMockUsageRollup(projectPath: string | undefined): UsageRollup {
  const day = (offset: number): string => {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  };
  const byDay: Record<string, UsageBucket> = {
    [day(12)]: usageBucket(15_000, 5_000, 20_000, 4_000, 6),
    [day(10)]: usageBucket(20_000, 6_000, 24_000, 2_000, 8),
    [day(8)]: usageBucket(12_000, 4_000, 18_000, 2_000, 5),
    [day(6)]: usageBucket(25_000, 8_000, 31_000, 4_000, 10),
    [day(4)]: usageBucket(28_000, 7_000, 35_000, 4_000, 12),
    [day(2)]: usageBucket(21_000, 7_000, 30_000, 3_000, 9),
    [day(0)]: usageBucket(36_000, 7_000, 40_000, 6_000, 16),
  };
  return {
    scope: projectPath ? { kind: 'project', projectPath } : { kind: 'global' },
    promptTokens: 157_000,
    completionTokens: 44_000,
    cacheReadTokens: 198_000,
    cacheWriteTokens: 25_000,
    totalTokens: 424_000,
    entryCount: 66,
    sessionCount: 12,
    firstAt: `${day(12)}T08:00:00.000Z`,
    lastAt: `${day(0)}T12:00:00.000Z`,
    byModel: {
      'gpt-5.2-codex': usageBucket(122_000, 30_000, 156_000, 20_000, 50),
      'claude-sonnet-4-5': usageBucket(35_000, 14_000, 42_000, 5_000, 16),
    },
    byModelKey: [
      {
        providerId: 'openai-work',
        modelId: 'gpt-5.2-codex',
        ...usageBucket(78_000, 18_000, 132_000, 12_000, 32),
      },
      {
        providerId: 'anthropic-main',
        modelId: 'claude-sonnet-4-5',
        ...usageBucket(35_000, 14_000, 42_000, 5_000, 16),
      },
      {
        providerId: 'openai-personal',
        modelId: 'gpt-5.2-codex',
        ...usageBucket(44_000, 12_000, 24_000, 8_000, 18),
      },
    ],
    byDay,
    bySession: [],
  };
}

/**
 * Deterministic call log for the browser mock. Generates enough rows to page
 * through, spread across the requested window, so the table, the summary and
 * the pager all have something real to render.
 */
export function createMockUsageCallLog(
  projectPath: string | undefined,
  windowMinutes: number,
  limit: number,
  offset: number,
): UsageCallLog {
  const now = Date.now();
  const models = [
    { modelId: 'gpt-5.2-codex', providerId: 'openai-work' },
    { modelId: 'claude-sonnet-4-5', providerId: 'anthropic-main' },
    { modelId: 'gpt-5.2-codex', providerId: 'openai-personal' },
  ];
  const total = 137;
  const spacingMs = Math.max(1, Math.floor((windowMinutes * 60_000) / total));
  const all = Array.from({ length: total }, (_, index) => {
    const model = models[index % models.length] ?? models[0]!;
    // Every 7th call misses the cache, so the hit/miss column is not uniform.
    const missed = index % 7 === 0;
    const promptTokens = missed ? 24_000 + index * 37 : 1_200 + index * 11;
    const completionTokens = 60 + ((index * 53) % 900);
    const cacheReadTokens = missed ? 0 : 90_000 + index * 613;
    const cacheWriteTokens = missed ? 4_200 : 0;
    return {
      id: `mock-call-${index}`,
      recordedAt: new Date(now - index * spacingMs - 20_000).toISOString(),
      sessionId: `mock-session-${(index % 4) + 1}`,
      projectPath: projectPath ?? null,
      providerId: model.providerId,
      modelId: model.modelId,
      promptTokens,
      completionTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens,
      durationMs: 2_400 + ((index * 911) % 26_000),
      source: 'assistant-usage' as const,
    };
  });
  const safeOffset = Math.min(Math.max(0, offset), Math.max(0, (Math.ceil(all.length / limit) - 1) * limit));
  const entries = all.slice(safeOffset, safeOffset + limit);
  return {
    windowMinutes,
    from: new Date(now - windowMinutes * 60_000).toISOString(),
    to: new Date(now).toISOString(),
    entries,
    offset: safeOffset,
    limit,
    totalInWindow: all.length,
    truncated: all.length > entries.length,
  };
}

export function usageBucket(
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  entryCount: number,
): UsageBucket {
  return {
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens,
    entryCount,
  };
}

export function mockSessionMessageResponse(
  sessionId: string,
  messages: readonly SessionTranscriptMessage[],
  projection: import('@piwin/contracts').SessionMessageProjection | undefined,
): {
  messages?: SessionTranscriptMessage[];
  transcriptPage?: import('@piwin/contracts').SessionTranscriptPageInfo;
} {
  if (projection === 'none') return {};
  if (projection !== 'tail') return { messages: [...messages] };
  const page = createMockSessionTranscriptPage(messages, {
    sessionId,
    limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
    maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  });
  if (page.status !== 'page') {
    throw new Error('Mock cursorless mutation projection unexpectedly returned stale');
  }
  return { messages: page.messages, transcriptPage: page.page };
}

export type MockSessionPageCursor = {
  revision: string;
  offset: number;
  limit: number;
};

export function compareMockSessionSummaries(
  left: SessionSummary,
  right: SessionSummary,
  order: import('@piwin/contracts').SessionListOrder,
): number {
  if (order === 'alphabetical') {
    const byName = (left.name ?? '').localeCompare(right.name ?? '');
    return byName !== 0 ? byName : left.id.localeCompare(right.id);
  }
  const leftPinned = left.isPinned === true;
  const rightPinned = right.isPinned === true;
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
  if (leftPinned && rightPinned) {
    const byPinnedAt = (right.pinnedAt ?? '').localeCompare(left.pinnedAt ?? '');
    if (byPinnedAt !== 0) return byPinnedAt;
  }
  const byUpdatedAt = right.updatedAt.localeCompare(left.updatedAt);
  return byUpdatedAt !== 0 ? byUpdatedAt : left.id.localeCompare(right.id);
}

export function mockSessionPageRevision(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
}

export function formatMockSessionPageCursor(cursor: MockSessionPageCursor): string {
  return `mock_${cursor.revision}_${cursor.offset}_${cursor.limit}`;
}

export function parseMockSessionPageCursor(value: string): MockSessionPageCursor | null {
  const match = /^mock_([a-f0-9]{64})_(\d+)_(\d+)$/.exec(value);
  if (!match) return null;
  const revision = match[1];
  const rawOffset = match[2];
  const rawLimit = match[3];
  if (revision === undefined || rawOffset === undefined || rawLimit === undefined) return null;
  const offset = Number(rawOffset);
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit <= 0) {
    return null;
  }
  return { revision, offset, limit };
}

export function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length > 0 ? chunks : [''];
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function waitForMockAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

export function mockQueuedInputFingerprint(input: PromptInput): string {
  return JSON.stringify(input, Object.keys(input).sort());
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function validateMockQueuedTurnInput(input: PromptInput): string | undefined {
  const hasText = input.text.trim().length > 0;
  const hasAttachments = (input.attachments?.length ?? 0) > 0;
  const hasContext = (input.contextRefs?.length ?? 0) > 0;
  if (!hasText && !hasAttachments && !hasContext) {
    return 'queued-turn-empty: text, attachment, or context is required';
  }
  if (byteLength(input.text) > QUEUED_TURN_MAX_TEXT_BYTES) {
    return 'queued-turn-bounds-exceeded: text exceeds 64 KiB';
  }
  if (input.source === 'resume' || input.source === 'continuation' || input.resumeCheckpointId !== undefined) {
    return 'queued-turn-input-invalid: resume prompts cannot be queued';
  }
  return undefined;
}
