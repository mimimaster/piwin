import type {
  PromptInput,
  SessionSummary,
  SessionTranscriptMessage,
  ThemeManifest,
} from '@piwin/contracts';
import {
  QUEUED_TURN_MAX_TEXT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
} from '@piwin/contracts';
import { createMockSessionTranscriptPage } from './mock-session-transcript-page';
import {
  PIWIN_APPEARANCE_INKSTONE_INK,
  PIWIN_APPEARANCE_INKSTONE_PAPER,
  migrateThemeId,
} from '../theme/appearance-tokens';

export type MockBuiltinThemeId =
  | 'piwin-inkstone'
  | 'piwin-inkstone-paper'
  | 'piwin-inkstone-ink';

export function resolveMockThemeId(themeId: string): MockBuiltinThemeId {
  const migrated = migrateThemeId(themeId);
  if (
    migrated === 'piwin-inkstone-paper' ||
    migrated === 'piwin-inkstone-ink' ||
    migrated === 'piwin-inkstone'
  ) {
    return migrated;
  }
  return 'piwin-inkstone-ink';
}

export function mockThemeManifest(themeId: MockBuiltinThemeId): ThemeManifest {
  switch (themeId) {
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

type MockStreamProbeEntry = { messageId: string; text: string; at: number };

/**
 * e2e render-lag probe: when a test installs `globalThis.__piwinStreamProbe`
 * (an array), each mock text delta notes what had been pushed and when, so
 * the test can time push → paint. Absent in every normal run.
 */
export function recordMockStreamProbe(messageId: string, text: string): void {
  const probe = (globalThis as { __piwinStreamProbe?: MockStreamProbeEntry[] }).__piwinStreamProbe;
  if (Array.isArray(probe)) probe.push({ messageId, text, at: performance.now() });
}
