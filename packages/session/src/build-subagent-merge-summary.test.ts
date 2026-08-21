import { describe, expect, it } from 'vitest';
import {
  buildSubagentMergeSummary,
  formatSubagentMergeCard,
  MAX_SUBAGENT_SUMMARY_CHARS,
} from './build-subagent-merge-summary.js';

describe('buildSubagentMergeSummary', () => {
  it('concatenates assistant messages and prefixes task', () => {
    const result = buildSubagentMergeSummary({
      task: 'Investigate auth',
      name: 'auth-check',
      status: 'done',
      messages: [
        { role: 'user', text: 'go' },
        { role: 'assistant', text: 'Found bug in middleware.', status: 'done' },
        { role: 'assistant', text: 'Fixed and verified.', status: 'done' },
      ],
    });
    expect(result.summaryText).toContain('Investigate auth');
    expect(result.summaryText).toContain('Found bug in middleware.');
    expect(result.summaryText).toContain('Fixed and verified.');
    expect(result.truncated).toBe(false);
  });

  it('returns empty fallback when no assistant text', () => {
    const result = buildSubagentMergeSummary({
      messages: [{ role: 'user', text: 'only user' }],
    });
    expect(result.summaryText).toContain('Sub-agent produced no assistant text.');
  });

  it('caps long summaries', () => {
    const long = 'x'.repeat(MAX_SUBAGENT_SUMMARY_CHARS + 500);
    const result = buildSubagentMergeSummary({
      messages: [{ role: 'assistant', text: long, status: 'done' }],
      maxChars: 100,
    });
    expect(result.truncated).toBe(true);
    expect(result.summaryText).toContain('…[truncated]');
  });

  it('prefers the last contract-shaped assistant message', () => {
    const result = buildSubagentMergeSummary({
      task: 'map paths',
      name: 'scout',
      status: 'done',
      messages: [
        { role: 'assistant', text: 'Working through DESIGN.md…', status: 'done' },
        {
          role: 'assistant',
          text: 'complete\n- display_path is in src/paths.rs:16',
          status: 'done',
        },
      ],
    });
    expect(result.summaryText).toContain('complete\n- display_path is in src/paths.rs:16');
    expect(result.summaryText).not.toContain('Working through DESIGN.md');
  });

  it('keeps the status line when truncating a contract report', () => {
    const result = buildSubagentMergeSummary({
      messages: [
        {
          role: 'assistant',
          text: `complete\n${'x'.repeat(200)}`,
          status: 'done',
        },
      ],
      maxChars: 40,
    });
    expect(result.truncated).toBe(true);
    expect(result.summaryText).toMatch(/Summary:\ncomplete\n/);
    expect(result.summaryText).toContain('…[truncated]');
  });

  it('formats merge card with child id', () => {
    const card = formatSubagentMergeCard({
      summaryText: 'hello',
      childSessionId: 'child-1',
    });
    expect(card).toContain('childSessionId=child-1');
  });
});
