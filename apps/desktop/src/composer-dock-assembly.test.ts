import { describe, expect, it } from 'vitest';
import {
  isGoalExtensionEnabled,
  listSessionUserPrompts,
  resolveComposerLayoutMode,
} from './composer-dock-assembly.js';

describe('listSessionUserPrompts', () => {
  it('returns newest-first unique user texts, capped at 10', () => {
    const messages = [
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: 'second' },
      { role: 'user', text: '  ' },
      { role: 'user', text: 'second' },
      { role: 'user', text: 'third' },
    ];
    expect(listSessionUserPrompts(messages)).toEqual(['third', 'second', 'first']);
  });
});

describe('resolveComposerLayoutMode', () => {
  it('centers only an empty live transcript', () => {
    expect(
      resolveComposerLayoutMode({ messageCount: 0, awaitingTranscript: false }),
    ).toBe('centered');
    expect(
      resolveComposerLayoutMode({ messageCount: 0, awaitingTranscript: true }),
    ).toBe('docked');
    expect(
      resolveComposerLayoutMode({ messageCount: 1, awaitingTranscript: false }),
    ).toBe('docked');
  });
});

describe('isGoalExtensionEnabled', () => {
  it('treats a missing list as enabled and matches goal case-insensitively', () => {
    expect(isGoalExtensionEnabled(undefined)).toBe(true);
    expect(isGoalExtensionEnabled([])).toBe(true);
    expect(isGoalExtensionEnabled(['Goal'])).toBe(false);
    expect(isGoalExtensionEnabled(['browser'])).toBe(true);
  });
});
