import { describe, expect, it } from 'vitest';
import { parseArtifactActionMessage } from './bridge-protocol.js';
import { ARTIFACT_BRIDGE_ACTION_TYPE } from './constants.js';
import { MAX_ARTIFACT_DOWNLOAD_BYTES } from '@piwin/contracts';

describe('parseArtifactActionMessage', () => {
  const downloadMessage = (payload: unknown) => ({
    type: ARTIFACT_BRIDGE_ACTION_TYPE,
    channelId: 'fence-1',
    action: 'artifact/download',
    payload,
  });

  it('accepts generated file bytes instead of asking the agent to write a file', () => {
    const payload = { filename: 'cat.png', dataUrl: 'data:image/png;base64,AQID' };
    expect(parseArtifactActionMessage(downloadMessage(payload))).toEqual(downloadMessage(payload));
  });

  it('checks decoded bytes at the exact size limit, including base64 padding', () => {
    const base64Length = Math.ceil(MAX_ARTIFACT_DOWNLOAD_BYTES / 3) * 4;
    const dataUrl = 'data:application/octet-stream;base64,' + 'A'.repeat(base64Length - 1) + '=';
    expect(parseArtifactActionMessage(downloadMessage({ dataUrl }))).not.toBeNull();
    expect(parseArtifactActionMessage(downloadMessage({ dataUrl: dataUrl.slice(0, -1) + 'A' }))).toBeNull();
  });

  it.each([
    { filename: '../cat.png', dataUrl: 'https://example.com/cat.png' },
    { filename: 'cat.png', dataUrl: 'file:///etc/passwd' },
    { filename: 'cat.png', dataUrl: 'blob:null/1234' },
    { filename: 'cat.png', dataUrl: 'data:image/png;base64,!!!=' },
    { filename: 'cat.png', dataUrl: 'data:image/png;base64,A===' },
    { filename: 'cat.png', dataUrl: 'data:image/png;base64,AQ' },
    { filename: 'x'.repeat(257), dataUrl: 'data:image/png;base64,AQID' },
    { filename: 'cat.png', dataUrl: 'data:image/png;base64,' + 'AAAA'.repeat(3 * 1024 * 1024) },
  ])('rejects malformed, nonlocal and oversized downloads', (payload) => {
    expect(parseArtifactActionMessage(downloadMessage(payload))).toBeNull();
  });

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

  it('accepts artifact/open-link only for absolute http(s) and mailto URLs', () => {
    const open = (url: unknown) =>
      parseArtifactActionMessage({ type: ARTIFACT_BRIDGE_ACTION_TYPE, channelId: 'fence-1', action: 'artifact/open-link', payload: { url } });
    expect(open('https://github.com/x/y ')).toEqual({
      type: ARTIFACT_BRIDGE_ACTION_TYPE,
      channelId: 'fence-1',
      action: 'artifact/open-link',
      payload: { url: 'https://github.com/x/y' },
    });
    expect(open('mailto:a@b.c')?.payload).toEqual({ url: 'mailto:a@b.c' });
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '/relative', 'https://u:p@x.com', 42, `https://x.com/${'a'.repeat(3000)}`]) {
      expect(open(bad)).toBeNull();
    }
  });
});
