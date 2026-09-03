import { describe, expect, it } from 'vitest';
import {
  LIVE_STARTUP_CONTEXT_MAX_CHARS,
  PIWIN_LIVE_STARTUP_CONTEXT_HEADER,
  clipLiveContextText,
  piwinLiveTypedInputContext,
  renderLiveStartupContext,
  toLiveContextTranscriptTurn,
} from './live-session-context.js';
import type { SessionTranscriptMessage } from './session-transcript.js';

describe('live session context copy', () => {
  it('wraps a summary with the startup header and does not leak other session titles', () => {
    const rendered = renderLiveStartupContext('User is fixing Live voice context.');
    expect(rendered).toContain(PIWIN_LIVE_STARTUP_CONTEXT_HEADER);
    expect(rendered).toContain('<startup_context>');
    expect(rendered).toContain('User is fixing Live voice context.');
    expect(rendered).toContain('</startup_context>');
    expect(rendered).not.toContain('Other');
  });

  it('clips typed input, forbids re-delegation, and promises no admission', () => {
    const spoken = piwinLiveTypedInputContext(`  ${'please fix '.repeat(80)}  `);
    expect(spoken).toContain('do not delegate it');
    expect(spoken).toContain('Do not claim you started, queued, or finished it');
    expect(spoken).toContain('<typed_input>');
    expect(spoken.length).toBeLessThan(900);
  });

  it('clip helper stays within the startup char cap', () => {
    const clipped = clipLiveContextText('晴朗 '.repeat(2_000), LIVE_STARTUP_CONTEXT_MAX_CHARS);
    expect(clipped.length).toBeLessThanOrEqual(LIVE_STARTUP_CONTEXT_MAX_CHARS + 1);
    expect(clipped.endsWith('…')).toBe(true);
  });
});

describe('toLiveContextTranscriptTurn', () => {
  function message(overrides: Partial<SessionTranscriptMessage>): SessionTranscriptMessage {
    return {
      id: 'm1',
      role: 'user',
      text: 'hello',
      status: 'done',
      createdAt: '2026-09-03T00:00:00.000Z',
      runtimeGenerationId: 'user-authored',
      ...overrides,
    } as SessionTranscriptMessage;
  }

  it('labels a voice handover apart from typed user text', () => {
    expect(toLiveContextTranscriptTurn(message({ source: 'voice-delegation' }))).toEqual({
      role: 'user',
      label: 'Voice handover',
      text: 'hello',
    });
    expect(toLiveContextTranscriptTurn(message({}))?.label).toBe('User');
  });

  it('collapses whitespace in assistant text', () => {
    expect(
      toLiveContextTranscriptTurn(message({ role: 'assistant', text: ' done\n\n  now ' })),
    ).toEqual({ role: 'assistant', label: 'Assistant', text: 'done now' });
  });

  it('rejects unfinished, empty, and non-conversational rows', () => {
    expect(toLiveContextTranscriptTurn(message({ status: 'streaming' }))).toBeNull();
    expect(toLiveContextTranscriptTurn(message({ text: '   ' }))).toBeNull();
    expect(toLiveContextTranscriptTurn(message({ role: 'system' }))).toBeNull();
  });
});
