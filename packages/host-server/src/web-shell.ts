import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Serve one built SPA directory on the Host HTTP listener.
 * Unknown paths return index.html so a refresh stays in the app.
 * A path that escapes the directory is 403, not a file from elsewhere.
 */
export async function serveWebShell(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const rootPath = resolve(root);
  const relative = requestPath(request.url ?? '/');
  const candidate = resolve(rootPath, relative);
  if (!isInside(rootPath, candidate)) {
    response.writeHead(403).end();
    return;
  }
  const file = (await existingFile(candidate)) ?? join(rootPath, 'index.html');
  if (!isInside(rootPath, file) || (await existingFile(file)) === undefined) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': file.endsWith(`${sep}index.html`) ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

function requestPath(url: string): string {
  const pathname = decodeURIComponent(url.split('?')[0] ?? '/');
  const cleaned = normalize(pathname).replace(/^[/\\]+/, '');
  return cleaned.length === 0 ? 'index.html' : cleaned;
}

async function existingFile(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    return info.isFile() ? path : undefined;
  } catch {
    return undefined;
  }
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}
