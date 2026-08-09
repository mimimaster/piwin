import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_FILE_ACCEPT,
  attachmentContentKindForFile,
  inferAttachmentMimeType,
  isSupportedAttachmentMimeType,
} from './attachment.js';

describe('attachment classification', () => {
  it('recognizes common source files from their extension', () => {
    expect(inferAttachmentMimeType('src/main.ts')).toBe('application/typescript');
    expect(attachmentContentKindForFile('config.yaml')).toBe('text');
    expect(attachmentContentKindForFile('report.pdf')).toBe('document');
  });

  it('uses magic bytes when browser MIME metadata is empty', () => {
    expect(
      inferAttachmentMimeType('clipboard.bin', '', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39])),
    ).toBe('image/gif');
    expect(
      inferAttachmentMimeType('download.bin', '', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])),
    ).toBe('application/pdf');
  });

  it('accepts text wildcards and exposes the picker allowlist', () => {
    expect(isSupportedAttachmentMimeType('text/x-python')).toBe(true);
    expect(isSupportedAttachmentMimeType('application/x-executable')).toBe(false);
    expect(ATTACHMENT_FILE_ACCEPT).toContain('.ts');
    expect(ATTACHMENT_FILE_ACCEPT).toContain('application/pdf');
  });
});
