import { describe, expect, it } from 'vitest';
import { parseArtifactActionMessage } from './bridge-protocol.js';
import { ARTIFACT_BRIDGE_ACTION_TYPE } from './constants.js';

const VALID = {
  type: ARTIFACT_BRIDGE_ACTION_TYPE,
  channelId: 'fence-1',
  action: 'flashcard/rate',
  payload: { cardId: 'card-abc12345-xyz', rating: 'good' },
};

describe('parseArtifactActionMessage', () => {
  it('accepts a valid flashcard/rate action', () => {
    const parsed = parseArtifactActionMessage(VALID);
    expect(parsed).toEqual(VALID);
  });

  it('accepts all four ratings', () => {
    for (const rating of ['again', 'hard', 'good', 'easy']) {
      const parsed = parseArtifactActionMessage({
        ...VALID,
        payload: { ...VALID.payload, rating },
      });
      expect(parsed?.payload.rating).toBe(rating);
    }
  });

  it('rejects unknown actions (whitelist)', () => {
    expect(
      parseArtifactActionMessage({ ...VALID, action: 'fs/write' }),
    ).toBeNull();
    expect(
      parseArtifactActionMessage({ ...VALID, action: 'flashcard/delete' }),
    ).toBeNull();
  });

  it('rejects wrong type / non-object payloads', () => {
    expect(parseArtifactActionMessage(null)).toBeNull();
    expect(parseArtifactActionMessage('str')).toBeNull();
    expect(parseArtifactActionMessage({ ...VALID, type: 'piwin-artifact:ready' })).toBeNull();
    expect(parseArtifactActionMessage({ ...VALID, payload: 'nope' })).toBeNull();
  });

  it('rejects malformed card ids (injection surface)', () => {
    for (const cardId of [
      'not-a-card-id',
      'card-../../etc',
      'card-' + 'x'.repeat(100),
      '',
      42,
    ]) {
      expect(
        parseArtifactActionMessage({ ...VALID, payload: { cardId, rating: 'good' } }),
      ).toBeNull();
    }
  });

  it('rejects invalid ratings', () => {
    expect(
      parseArtifactActionMessage({
        ...VALID,
        payload: { cardId: VALID.payload.cardId, rating: 'amazing' },
      }),
    ).toBeNull();
  });

  it('rejects missing or oversized channelId', () => {
    expect(parseArtifactActionMessage({ ...VALID, channelId: '' })).toBeNull();
    expect(
      parseArtifactActionMessage({ ...VALID, channelId: 'x'.repeat(201) }),
    ).toBeNull();
  });
});
