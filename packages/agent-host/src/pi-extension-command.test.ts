import { describe, expect, it, vi } from 'vitest';
import { selectPiPromptText } from './pi-extension-command.js';

describe('loaded Pi command selection', () => {
  const assembled = '<host-context>rules/history</host-context>\n\n/teacher ta\n\n<theme>dark</theme>';
  it('preserves exactly the raw command and args only when this generation registered it', () => {
    const getCommand = vi.fn(name => name === 'teacher' ? { handler: 'opaque' } : undefined);
    expect(selectPiPromptText({ extensionRunner: { getCommand } }, assembled, '/teacher ta')).toBe('/teacher ta');
    expect(getCommand).toHaveBeenCalledWith('teacher');
  });
  it.each([undefined, '', 'Explain /teacher ta', '\n/teacher ta', '/missing ta'])('does not turn non-command/history/stale tokens into role changes: %s', text => {
    expect(selectPiPromptText({ extensionRunner: { getCommand: name => name === 'teacher' ? {} : undefined } }, assembled, text)).toBe(assembled);
  });
  it('does not dispatch when the generation has no extension runner or with images', () => {
    expect(selectPiPromptText({}, assembled, '/teacher ta')).toBe(assembled);
    expect(selectPiPromptText({ extensionRunner: { getCommand: () => ({}) } }, assembled, '/teacher ta', true)).toBe(assembled);
  });
});
