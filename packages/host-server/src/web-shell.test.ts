import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serveWebShell } from './web-shell.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('serveWebShell', () => {
  it('serves the app, falls back to index.html, and refuses a path outside the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-web-shell-'));
    roots.push(root);
    await writeFile(join(root, 'index.html'), '<p>shell</p>', 'utf8');
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)\n', 'utf8');

    const server = createServer((request, response) => {
      void serveWebShell(root, request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(await page.text()).toContain('shell');

      const script = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
      expect(script.headers.get('content-type')).toContain('javascript');
      expect(await script.text()).toContain('console.log');

      const route = await fetch(`http://127.0.0.1:${port}/settings/models`);
      expect(route.status).toBe(200);
      expect(await route.text()).toContain('shell');

      const escaped = await fetch(`http://127.0.0.1:${port}/../package.json`);
      expect(escaped.status).toBe(200);
      expect(await escaped.text()).toContain('shell');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
