import { describe, expect, it } from 'vitest';
import {
  formatSessionPackCreateResult,
  formatSessionPackList,
  formatSessionPackVerifyResult,
} from './session-pack-command.js';

describe('session pack CLI formatting', () => {
  it('formats create results', () => {
    const text = formatSessionPackCreateResult({
      packId: 'pack-1',
      packPath: '/tmp/out/pack-1.piwin-pack',
      sidecarPath: '/tmp/out/pack-1.piwin-pack.sha256',
      sessionId: 'ses_1',
      archiveSha256: 'a'.repeat(64),
      transcriptSha256: 'b'.repeat(64),
      payloadBytes: 12,
      mediaIncluded: false,
      createdAt: '2026-08-12T00:00:00.000Z',
    });
    expect(text).toContain('packId: pack-1');
    expect(text).toContain('mediaIncluded: false');
  });

  it('formats verify and list results', () => {
    const verify = formatSessionPackVerifyResult({
      packPath: '/tmp/out/pack-1.piwin-pack',
      sidecarPath: '/tmp/out/pack-1.piwin-pack.sha256',
      packId: 'pack-1',
      sessionId: 'ses_1',
      archiveSha256: 'a'.repeat(64),
      transcriptSha256: 'b'.repeat(64),
      payloadBytes: 12,
      mediaIncluded: false,
      messageCount: 2,
      valid: true,
    });
    expect(verify).toContain('valid: true');
    expect(verify).toContain('messageCount: 2');

    const list = formatSessionPackList({
      directory: '/tmp/out',
      packs: [
        {
          packId: 'pack-1',
          packPath: '/tmp/out/pack-1.piwin-pack',
          sidecarPath: '/tmp/out/pack-1.piwin-pack.sha256',
          sessionId: 'ses_1',
          payloadBytes: 12,
          mediaIncluded: false,
          messageCount: 2,
          createdAt: '2026-08-12T00:00:00.000Z',
          valid: true,
        },
      ],
    });
    expect(list).toContain('pack-1');
    expect(list).toContain('ses_1');
  });
});
