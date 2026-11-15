import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, test } from '@playwright/test';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let output: string;
let server: Server;
let url: string;

test.beforeAll(async () => {
  output = await mkdtemp(resolve(tmpdir(), 'piwin-terminal-production-'));
  await build({
    configFile: resolve(desktopRoot, 'vite.config.ts'), root: desktopRoot, logLevel: 'silent',
    build: {
      outDir: output, target: 'safari13', minify: 'esbuild', sourcemap: false,
      rollupOptions: { input: resolve(desktopRoot, 'e2e/fixtures/terminal-production.html') },
    },
  });
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file = resolve(output, `.${pathname}`);
    if (!file.startsWith(`${output}${sep}`)) { response.writeHead(403).end(); return; }
    const contentTypes: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
    void readFile(file).then((bytes) => {
      response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' });
      response.end(bytes);
    }, () => { response.writeHead(404).end(); });
  });
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing production fixture address');
  url = `http://127.0.0.1:${address.port}/e2e/fixtures/terminal-production.html`;
});

test.afterAll(async () => {
  if (server !== undefined) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  if (output !== undefined) await rm(output, { recursive: true, force: true });
});

test('release terminal parses Antigravity startup mode queries and keeps painting', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.painted))
    .toContain('Antigravity startup parsed');
  const replies: unknown = await page.evaluate(() => JSON.parse(document.documentElement.dataset.replies ?? '[]'));
  expect(replies).toEqual(expect.arrayContaining(['\x1b[?2026;2$y', '\x1b[?2027;0$y']));
  expect(errors).toEqual([]);
});
