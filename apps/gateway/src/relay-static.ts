import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/**
 * Serves the browser shell from `--web-root` (ADR 0101 §8). Unknown paths fall
 * back to index.html (a pairing link is `/#pair=…`; the fragment never reaches
 * here). Anything resolving outside the root is 403.
 *
 * The Host serves the same bundle with its own `web-shell.ts`; the relay may
 * not depend on `@piwin/host-server` (AGENTS.md §1.13), so it keeps this
 * small server of its own.
 */
export async function serveRelayStatic(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const rootPath = resolve(root);
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://relay').pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  const candidate = resolve(rootPath, `.${pathname}`);
  if (candidate !== rootPath && !candidate.startsWith(rootPath + sep)) {
    response.writeHead(403).end();
    return;
  }
  const file =
    (await existingFile(candidate)) ?? (await existingFile(join(candidate, 'index.html')));
  const target = file ?? (await existingFile(join(rootPath, 'index.html')));
  if (target === undefined) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': target.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(target).pipe(response);
}

async function existingFile(path: string): Promise<string | undefined> {
  try {
    return (await stat(path)).isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}
