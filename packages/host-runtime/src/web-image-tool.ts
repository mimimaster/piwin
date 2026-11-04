/**
 * `web_image` Host tool: fetch one web image and persist it in the session
 * media vault so the transcript can render it.
 *
 * Display is already solved downstream: a `tool/end` result carrying
 * `details.attachments` is merged into the assistant message's attachments and
 * rendered by the media gallery. This tool therefore adds no app-side code and
 * no contract field — only the missing Host step that turns a web URL into a
 * media asset.
 *
 * Permission reuses `network:web_fetch`: the operation is literally fetching a
 * web resource, so existing rules, remember-host behavior, and approval copy
 * stay authoritative instead of inventing a parallel network action.
 */

import type { HostToolRegistration, ToolResult, WebConfig } from '@piwin/contracts';
import { toMediaAttachmentRef } from '@piwin/contracts';
import { createMediaService } from '@piwin/media';
import {
  MAX_WEB_IMAGE_BYTES,
  WEB_IMAGE_MIME_TYPES,
  fetchWebImage,
  formatWebImageOutput,
} from '@piwin/tools-web';
import type { FetchHostResolver } from '@piwin/tools-web';

const MIME_TO_EXTENSION: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export type WebImageToolOptions = {
  /** `~/.piwin/media`; the per-session vault directory is created under it. */
  mediaRoot: string;
  webConfig?: Partial<WebConfig> | undefined;
  /** Test / Host-injected DNS resolver for fetch SSRF checks. */
  resolveHostAddresses?: FetchHostResolver | undefined;
  /** Test seam for the transport. */
  fetchImpl?: typeof fetch | undefined;
};

export function createWebImageTool(options: WebImageToolOptions): HostToolRegistration {
  const media = createMediaService({
    mediaRoot: options.mediaRoot,
    maxPasteBytes: MAX_WEB_IMAGE_BYTES,
    allowedMimeTypes: [...WEB_IMAGE_MIME_TYPES],
  });

  return {
    descriptor: {
      name: 'web_image',
      description:
        'Download one image from a page URL (its og:image / representative image) or a direct image URL (png, jpeg, webp, gif) and attach it to the reply so the user can see it. Use it right after web_search when a picture helps: pass the hit URL, not a guessed image path. Rejects private hosts, SVG, and images over 8 MiB.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Page URL or direct http(s) image URL',
          },
        },
        required: ['url'],
      },
    },
    family: 'web-fetch',
    permissionSpec: {
      action: 'network:web_fetch',
      risk: 'network',
      rememberable: true,
      subjectBuilder: (args) => {
        try {
          return { kind: 'web-fetch', host: new URL(String(args.url ?? '')).hostname.toLowerCase() };
        } catch {
          return undefined;
        }
      },
    },
    prepareArgs: (rawArguments, _context, signal) => {
      if (signal.aborted) {
        return { ok: false, result: { ok: false, code: 'aborted', message: 'tool preparation aborted' } };
      }
      const rawUrl = rawArguments.url;
      if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
        return { ok: false, result: { ok: false, code: 'invalid-input', message: 'url is required' } };
      }
      const url = rawUrl.trim();
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return {
            ok: false,
            result: { ok: false, code: 'invalid-input', message: 'url must be http(s)' },
          };
        }
      } catch {
        return { ok: false, result: { ok: false, code: 'invalid-input', message: 'url is invalid' } };
      }
      return { ok: true, arguments: { ...rawArguments, url } };
    },
    async execute(args, signal, context): Promise<ToolResult> {
      try {
        const image = await fetchWebImage({
          url: String(args.url ?? ''),
          signal,
          ...(options.webConfig ? { config: options.webConfig } : {}),
          ...(options.resolveHostAddresses
            ? { resolveHostAddresses: options.resolveHostAddresses }
            : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        });
        const asset = await media.saveMediaAsset({
          sessionId: context.sessionId,
          bytes: image.bytes,
          mimeType: image.mimeType,
          name: `web-image${MIME_TO_EXTENSION[image.mimeType] ?? ''}`,
          source: 'generated',
        });
        const attachment = toMediaAttachmentRef(asset, 'generated');
        return {
          ok: true,
          output: formatWebImageOutput(image, asset.id),
          details: {
            attachments: [attachment],
            mediaId: asset.id,
            imageUrl: image.imageUrl,
            ...(image.pageUrl !== undefined ? { pageUrl: image.pageUrl } : {}),
            ...(image.pageTitle !== undefined ? { pageTitle: image.pageTitle } : {}),
            mimeType: image.mimeType,
            byteSize: asset.byteSize,
            discovery: image.discovery,
          },
        };
      } catch (error) {
        return {
          ok: false,
          code: 'execution-failed',
          message: error instanceof Error ? error.message : 'web image fetch failed',
        };
      }
    },
  };
}
