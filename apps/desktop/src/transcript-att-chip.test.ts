import { describe, expect, it } from 'vitest';
import {
  isTranscriptMediaPreviewable,
  transcriptAttFromContextRef,
  transcriptAttFromMedia,
} from './transcript-att-chip';

describe('transcriptAttFromContextRef', () => {
  it('renders a file ref as a file capsule', () => {
    expect(
      transcriptAttFromContextRef({
        kind: 'file',
        projectPath: '/p',
        relativePath: 'apps/desktop/src/composer-dock.test.tsx',
        label: 'composer-dock.test.tsx',
      }),
    ).toEqual({ variant: 'file', text: 'composer-dock.test.tsx' });
  });

  it('renders a selection as an @ mention capsule', () => {
    expect(
      transcriptAttFromContextRef({
        kind: 'selection',
        relativePath: 'docs/AGENTS.md',
        snapshotText: '§3.3',
        label: 'AGENTS.md §3.3',
      }),
    ).toEqual({ variant: 'mention', text: '@ AGENTS.md §3.3' });
  });

  it('uses the selection label when there is no path', () => {
    expect(
      transcriptAttFromContextRef({
        kind: 'selection',
        snapshotText: 'visible title',
        label: '导出 Markdown 报告',
      }),
    ).toEqual({ variant: 'mention', text: '@ 导出 Markdown 报告' });
  });
});

describe('transcriptAttFromMedia', () => {
  it('renders a media attachment as an image capsule', () => {
    expect(
      transcriptAttFromMedia({
        id: 'a1',
        kind: 'media',
        mimeType: 'image/png',
        path: '/tmp/piwin/media/截图 2026-09-03.png',
        name: '截图 2026-09-03.png',
        byteSize: 12,
        source: 'paste',
      }),
    ).toEqual({ variant: 'image', text: '截图 2026-09-03.png' });
  });
});

describe('isTranscriptMediaPreviewable', () => {
  it('allows images and videos, not documents', () => {
    expect(
      isTranscriptMediaPreviewable({
        id: 'a1',
        kind: 'media',
        mimeType: 'image/png',
        path: '/tmp/a.png',
        byteSize: 12,
        source: 'paste',
      }),
    ).toBe(true);
    expect(
      isTranscriptMediaPreviewable({
        id: 'a2',
        kind: 'media',
        mimeType: 'video/mp4',
        path: '/tmp/a.mp4',
        byteSize: 12,
        source: 'generated',
      }),
    ).toBe(true);
    expect(
      isTranscriptMediaPreviewable({
        id: 'a3',
        kind: 'media',
        mimeType: 'application/pdf',
        path: '/tmp/a.pdf',
        byteSize: 12,
        source: 'file-picker',
      }),
    ).toBe(false);
  });
});
