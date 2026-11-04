import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MediaAttachmentRef, ToolResult } from '@piwin/contracts';
import { createWebImageTool } from './web-image-tool.js';

const PNG_PAYLOAD = 'PNG-PAYLOAD-BYTES';
const PNG_BYTES = new TextEncoder().encode(PNG_PAYLOAD);

const context = {
  sessionId: 'session-1',
  runtimeGenerationId: 'gen-1',
  runId: 'run-1',
  toolName: 'web_image',
};

function attachmentOf(result: ToolResult): MediaAttachmentRef {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.code}: ${result.message}`);
  }
  const attachments = result.details?.attachments;
  const first = Array.isArray(attachments) ? attachments[0] : undefined;
  if (!first) {
    throw new Error('expected an attachment');
  }
  return first;
}

function pageThenImage(imageContentType = 'image/png'): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url === 'https://example.com/b300') {
      return new Response(
        `<html><head><title>B300</title>
         <meta property="og:image" content="https://cdn.example.com/b300.png" />
         </head><body>b300</body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    }
    return new Response(PNG_PAYLOAD, {
      status: 200,
      headers: { 'content-type': imageContentType },
    });
  };
}

let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-web-image-'));
});

afterEach(async () => {
  await rm(mediaRoot, { recursive: true, force: true });
});

describe('createWebImageTool', () => {
  it('persists the fetched image into the session media vault and returns an attachment', async () => {
    const tool = createWebImageTool({ mediaRoot, fetchImpl: pageThenImage() });
    const result = await tool.execute({ url: 'https://example.com/b300' }, new AbortController().signal, context);

    expect(result.ok).toBe(true);
    const attachment = attachmentOf(result);
    expect(attachment.kind).toBe('media');
    expect(attachment.mimeType).toBe('image/png');
    expect(attachment.source).toBe('generated');
    expect(attachment.path.startsWith(join(mediaRoot, 'session-1'))).toBe(true);

    const bytes = await readFile(attachment.path);
    expect(new Uint8Array(bytes)).toEqual(PNG_BYTES);
    if (result.ok) {
      expect(result.output).toContain(`mediaId: ${attachment.id}`);
      expect(result.details?.imageUrl).toBe('https://cdn.example.com/b300.png');
      expect(result.details?.pageUrl).toBe('https://example.com/b300');
    }
  });

  it('reports a transport failure as a tool error instead of a fake success', async () => {
    const tool = createWebImageTool({
      mediaRoot,
      fetchImpl: async () => new Response('nope', { status: 404 }),
    });
    const result = await tool.execute({ url: 'https://example.com/missing' }, new AbortController().signal, context);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('execution-failed');
      expect(result.message).toContain('HTTP 404');
    }
  });

  it('declares the shared web_fetch network permission and host subject', () => {
    const tool = createWebImageTool({ mediaRoot });
    expect(tool.descriptor.name).toBe('web_image');
    expect(tool.family).toBe('web-fetch');
    expect(tool.permissionSpec.action).toBe('network:web_fetch');
    expect(
      tool.permissionSpec.subjectBuilder?.(
        { url: 'https://Example.COM/b300' },
        context,
      ),
    ).toEqual({ kind: 'web-fetch', host: 'example.com' });
  });

  it('rejects non-http urls during argument preparation', async () => {
    const tool = createWebImageTool({ mediaRoot });
    const preparation = await tool.prepareArgs?.(
      { url: 'file:///etc/passwd' },
      context,
      new AbortController().signal,
    );
    expect(preparation?.ok).toBe(false);
  });
});
