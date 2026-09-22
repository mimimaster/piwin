import { describe, expect, it } from 'vitest';
import { ARTIFACT_BRIDGE_ERROR_TYPE, ARTIFACT_ERROR_MESSAGE_MAX_CHARS } from './constants.js';
import { parseArtifactErrorMessage } from './bridge-protocol.js';

const base = {
  type: ARTIFACT_BRIDGE_ERROR_TYPE,
  channelId: 'chan-1',
  kind: 'script',
  message: "Uncaught SyntaxError: Identifier 'TEA' has already been declared",
};

describe('parseArtifactErrorMessage', () => {
  it('accepts a script failure with position and error name', () => {
    expect(
      parseArtifactErrorMessage({ ...base, name: 'SyntaxError', line: 155, column: 7 }),
    ).toEqual({
      type: ARTIFACT_BRIDGE_ERROR_TYPE,
      channelId: 'chan-1',
      kind: 'script',
      message: "Uncaught SyntaxError: Identifier 'TEA' has already been declared",
      name: 'SyntaxError',
      line: 155,
      column: 7,
    });
  });

  it('accepts an unhandled rejection', () => {
    const parsed = parseArtifactErrorMessage({ ...base, kind: 'rejection', message: 'boom' });
    expect(parsed?.kind).toBe('rejection');
  });

  it('omits position fields it cannot trust', () => {
    const parsed = parseArtifactErrorMessage({
      ...base,
      line: Number.NaN,
      column: -4,
      name: '   ',
    });
    expect(parsed).toEqual({
      type: ARTIFACT_BRIDGE_ERROR_TYPE,
      channelId: 'chan-1',
      kind: 'script',
      message: base.message,
    });
  });

  it('floors a fractional line number', () => {
    expect(parseArtifactErrorMessage({ ...base, line: 12.9 })?.line).toBe(12);
  });

  it('clips a hostile message so the parent cannot be grown by one string', () => {
    const parsed = parseArtifactErrorMessage({ ...base, message: 'x'.repeat(5_000) });
    expect(parsed?.message).toHaveLength(ARTIFACT_ERROR_MESSAGE_MAX_CHARS + 1);
    expect(parsed?.message.endsWith('…')).toBe(true);
  });

  it('rejects anything that is not this message', () => {
    expect(parseArtifactErrorMessage(null)).toBeNull();
    expect(parseArtifactErrorMessage('nope')).toBeNull();
    expect(parseArtifactErrorMessage({ ...base, type: 'piwin-artifact:size' })).toBeNull();
    expect(parseArtifactErrorMessage({ ...base, kind: 'whatever' })).toBeNull();
    expect(parseArtifactErrorMessage({ ...base, channelId: '' })).toBeNull();
    expect(parseArtifactErrorMessage({ ...base, channelId: 'c'.repeat(201) })).toBeNull();
    expect(parseArtifactErrorMessage({ ...base, message: '   ' })).toBeNull();
    expect(parseArtifactErrorMessage({ ...base, message: 42 })).toBeNull();
  });
});
