import { describe, expect, it } from 'vitest';
import { parseArtifactActionMessage } from './bridge-protocol.js';
import { ARTIFACT_BRIDGE_ACTION_TYPE } from './constants.js';

describe('parseArtifactActionMessage', () => {
  it('rejects leftover flashcard iframe actions', () => {
    expect(
      parseArtifactActionMessage({
        type: ARTIFACT_BRIDGE_ACTION_TYPE,
        channelId: 'fence-1',
        action: 'flashcard/rate',
        payload: { cardId: 'card-abc12345-xyz', rating: 'good' },
      }),
    ).toBeNull();
    expect(
      parseArtifactActionMessage({
        type: ARTIFACT_BRIDGE_ACTION_TYPE,
        channelId: 'fence-1',
        action: 'flashcard/open-source',
        payload: { cardId: 'card-abc12345-xyz' },
      }),
    ).toBeNull();
  });

  it('rejects unknown actions (whitelist)', () => {
    expect(
      parseArtifactActionMessage({
        type: ARTIFACT_BRIDGE_ACTION_TYPE,
        channelId: 'fence-1',
        action: 'fs/write',
        payload: {},
      }),
    ).toBeNull();
    expect(
      parseArtifactActionMessage({
        type: ARTIFACT_BRIDGE_ACTION_TYPE,
        channelId: 'fence-1',
        action: 'flashcard/delete',
        payload: {},
      }),
    ).toBeNull();
  });

  it('accepts artifact/download-unsupported with optional filename', () => {
    expect(
      parseArtifactActionMessage({
        type: ARTIFACT_BRIDGE_ACTION_TYPE,
        channelId: 'fence-1',
        action: 'artifact/download-unsupported',
        payload: {},
      }),
    ).toEqual({
      type: ARTIFACT_BRIDGE_ACTION_TYPE,
      channelId: 'fence-1',
      action: 'artifact/download-unsupported',
      payload: {},
    });
    expect(
      parseArtifactActionMessage({
        type: ARTIFACT_BRIDGE_ACTION_TYPE,
        channelId: 'fence-1',
        action: 'artifact/download-unsupported',
        payload: { filename: '水墨笺.html' },
      }),
    ).toMatchObject({
      action: 'artifact/download-unsupported',
      payload: { filename: '水墨笺.html' },
    });
  });

  it('accepts composer/propose-text', () => {
    expect(
      parseArtifactActionMessage({
        type: ARTIFACT_BRIDGE_ACTION_TYPE,
        channelId: 'fence-1',
        action: 'composer/propose-text',
        payload: { text: 'Use React.', label: 'Stack' },
      }),
    ).toEqual({
      type: ARTIFACT_BRIDGE_ACTION_TYPE,
      channelId: 'fence-1',
      action: 'composer/propose-text',
      payload: { text: 'Use React.', label: 'Stack' },
    });
  });

  it('rejects wrong type / non-object payloads', () => {
    expect(parseArtifactActionMessage(null)).toBeNull();
    expect(parseArtifactActionMessage('str')).toBeNull();
    expect(
      parseArtifactActionMessage({
        type: 'piwin-artifact:ready',
        channelId: 'fence-1',
        action: 'composer/propose-text',
        payload: { text: 'Use React.' },
      }),
    ).toBeNull();
    expect(
      parseArtifactActionMessage({
        type: ARTIFACT_BRIDGE_ACTION_TYPE,
        channelId: 'fence-1',
        action: 'composer/propose-text',
        payload: 'nope',
      }),
    ).toBeNull();
  });

  it('rejects missing or oversized channelId', () => {
    expect(
      parseArtifactActionMessage({
        type: ARTIFACT_BRIDGE_ACTION_TYPE,
        channelId: '',
        action: 'composer/propose-text',
        payload: { text: 'Use React.' },
      }),
    ).toBeNull();
    expect(
      parseArtifactActionMessage({
        type: ARTIFACT_BRIDGE_ACTION_TYPE,
        channelId: 'x'.repeat(201),
        action: 'composer/propose-text',
        payload: { text: 'Use React.' },
      }),
    ).toBeNull();
  });
});
