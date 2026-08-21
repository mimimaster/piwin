import { describe, expect, it } from 'vitest';
import { isPrimarySessionRecord } from './session-list-visibility.js';

describe('isPrimarySessionRecord', () => {
  it('treats main and kind-less records as listable', () => {
    expect(isPrimarySessionRecord({})).toBe(true);
    expect(isPrimarySessionRecord({ kind: 'main' })).toBe(true);
  });

  it('hides side-chat and subagent children from the main list', () => {
    expect(isPrimarySessionRecord({ kind: 'side-chat' })).toBe(false);
    expect(isPrimarySessionRecord({ kind: 'subagent' })).toBe(false);
  });
});
