/**
 * Characterize installed Pi 0.84.2 context-usage helpers.
 *
 * Production occupancy code must not copy these implementations; it only
 * needs the documented behavior below.
 *
 * Streaming partials: AgentSession exposes getContextUsage() and isStreaming,
 * but no streaming-partial / incremental-usage hook. Session persistence is
 * documented as happening on message_end. The sampler therefore tracks
 * message_update text, thinking, and tool-call args itself. Do not assume Pi
 * emits a context_usage event (the mapper has that branch; Pi is not emitting it).
 *
 * System prompt / tool definitions: estimateContextTokens only walks the
 * message list. getContextUsage() delegates to that estimate (or unknown
 * after compaction). Neither includes system prompt or tool-definition tokens.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AgentSession,
  calculateContextTokens,
  estimateTokens,
} from '@earendil-works/pi-coding-agent';

type PiUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

type PiContextEstimate = {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
};

type CompactionModule = {
  calculateContextTokens: (usage: PiUsage) => number;
  estimateContextTokens: (messages: unknown[]) => PiContextEstimate;
  estimateTokens: (message: unknown) => number;
};

const compactionHref = pathToFileURL(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js',
  ),
).href;

const compaction: CompactionModule = (await import(compactionHref)) as CompactionModule;

function usage(overrides: Partial<PiUsage> = {}): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...overrides,
  };
}

function assistant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: 'assistant',
    timestamp: 1,
    content: [{ type: 'text', text: 'ok' }],
    stopReason: 'stop',
    usage: usage({ input: 80_000, output: 10_000 }),
    ...overrides,
  };
}

describe('Pi 0.84.2 context usage characterization', () => {
  it('loads estimateContextTokens from the installed compaction module', () => {
    expect(typeof compaction.estimateContextTokens).toBe('function');
    expect(typeof compaction.calculateContextTokens).toBe('function');
    expect(compaction.calculateContextTokens).toBe(calculateContextTokens);
  });

  it('sums 80_000 input + 10_000 output + 0 cache to 90_000 without double-counting cache', () => {
    expect(
      calculateContextTokens(
        usage({ input: 80_000, output: 10_000, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }),
      ),
    ).toBe(90_000);
  });

  it('lets totalTokens win when present and non-zero', () => {
    expect(
      calculateContextTokens(
        usage({
          input: 80_000,
          output: 10_000,
          cacheRead: 5_000,
          cacheWrite: 1_000,
          totalTokens: 42,
        }),
      ),
    ).toBe(42);
  });

  it('skips aborted, error, and all-zero assistant usage as a baseline', () => {
    const trailingUser = { role: 'user', content: 'abcdefgh', timestamp: 2 };
    const aborted = compaction.estimateContextTokens([
      assistant({
        stopReason: 'aborted',
        usage: usage({ input: 80_000, output: 10_000, totalTokens: 90_000 }),
      }),
      trailingUser,
    ]);
    expect(aborted.lastUsageIndex).toBeNull();
    expect(aborted.usageTokens).toBe(0);

    const errored = compaction.estimateContextTokens([
      assistant({
        stopReason: 'error',
        usage: usage({ input: 80_000, output: 10_000, totalTokens: 90_000 }),
      }),
    ]);
    expect(errored.lastUsageIndex).toBeNull();

    const allZero = compaction.estimateContextTokens([
      assistant({ stopReason: 'stop', usage: usage() }),
      trailingUser,
    ]);
    expect(allZero.lastUsageIndex).toBeNull();
    expect(allZero.usageTokens).toBe(0);
  });

  it('adds trailing user/tool messages after the last valid usage (chars/4)', () => {
    const userText = 'abcdabcd'; // 8 chars → 2 tokens
    const toolText = 'abcdefghijkl'; // 12 chars → 3 tokens
    const estimate = compaction.estimateContextTokens([
      assistant({
        stopReason: 'stop',
        usage: usage({ input: 80_000, output: 10_000, totalTokens: 90_000 }),
      }),
      { role: 'user', content: userText, timestamp: 2 },
      {
        role: 'toolResult',
        content: toolText,
        timestamp: 3,
        toolCallId: 't1',
        toolName: 'read',
        isError: false,
      },
    ]);
    expect(estimate.usageTokens).toBe(90_000);
    expect(estimate.trailingTokens).toBe(
      estimateTokens({ role: 'user', content: userText, timestamp: 2 }) + 3,
    );
    expect(estimate.tokens).toBe(90_000 + estimate.trailingTokens);
    expect(estimate.lastUsageIndex).toBe(0);
  });

  it('does not invent system-prompt or tool-definition tokens from messages alone', () => {
    const estimate = compaction.estimateContextTokens([
      assistant({
        stopReason: 'stop',
        usage: usage({ input: 100, output: 20, totalTokens: 120 }),
      }),
    ]);
    expect(estimate.tokens).toBe(120);
    expect(estimate.trailingTokens).toBe(0);
  });

  it('documents that getContextUsage has no streaming-partial hook', () => {
    expect(typeof AgentSession.prototype.getContextUsage).toBe('function');
    const protoNames = Object.getOwnPropertyNames(AgentSession.prototype);
    expect(protoNames).toContain('getContextUsage');
    expect(protoNames).toContain('isStreaming');
    expect(protoNames.some((name) => /partial|stream(ing)?Usage|contextPartial/i.test(name))).toBe(
      false,
    );
  });
});
