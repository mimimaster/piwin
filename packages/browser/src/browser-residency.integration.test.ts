import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { createBrowserSession } from './browser-session.js';

const executablePath = process.env.PIWIN_BROWSER_REAL_EXECUTABLE;
const execFileAsync = promisify(execFile);

async function ownedChromePids(profileDir: string): Promise<number[]> {
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid,args']);
  return stdout.split('\n').filter((line) => line.includes(`--user-data-dir=${profileDir}`))
    .map((line) => Number(line.trim().split(/\s+/)[0])).filter(Number.isFinite);
}

it.skipIf(executablePath === undefined)('real Chromium: pauses pictures, releases idle process, restores URL/cookies, and protects edits/downloads', async () => {
  const profileDir = await mkdtemp(join(tmpdir(), 'piwin-browser-residency-'));
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cookieRequests: Array<string | undefined> = [];
  const server = createServer((request, response) => {
    if (request.url === '/download') {
      response.writeHead(200, { 'Content-Disposition': 'attachment; filename="fixture.txt"',
        'Content-Type': 'application/octet-stream' });
      response.write('fixture-start\n');
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!response.destroyed) response.end('fixture-end\n');
      }, 1500);
      timers.add(timer);
      return;
    }
    if (request.url?.startsWith('/readonly')) cookieRequests.push(request.headers.cookie);
    response.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'residency=retained; Max-Age=3600; Path=/' });
    response.end('<!doctype html><title>Residency fixture</title><h1>Read-only fixture</h1><input id="field"><button onclick="document.title=\'Unexpected action\'">Run action</button><a id="download" href="/download">Download</a>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No fixture address');
  const url = `http://127.0.0.1:${String(address.port)}/readonly`;
  const session = createBrowserSession({ profileDir, headless: true, keepAlive: true, maxFps: 2,
    ...(executablePath === undefined ? {} : { executablePath }) });
  const observations: Array<Record<string, unknown>> = [];
  let frames = 0;
  const unsubscribe = session.subscribe((event) => { if (event.type === 'browser/frame') frames += 1; });
  try {
    await session.navigate(url, { actor: 'user' });
    const previousRef = (await session.find('Run action')).candidates[0]?.ref;
    if (previousRef === undefined) throw new Error('Fixture button has no accessibility reference');
    const initialGeneration = session.status().generation;
    expect((await ownedChromePids(profileDir)).length).toBeGreaterThan(0);
    await session.start('window-a', { clientKey: 'a' });
    await session.start('window-b', { clientKey: 'b' });
    expect(await session.suspendIdle(Date.now())).toMatchObject({ suspended: false, reason: 'visible' });
    await session.stop('window-a');
    expect(session.mirrorLeaseCount()).toBe(1);
    const before = frames;
    await vi.waitFor(() => expect(frames).toBeGreaterThan(before), { timeout: 5000 });
    await session.stop('window-b');
    const afterStop = frames;
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    expect(frames).toBe(afterStop);
    observations.push({ phase: 'all-mirrors-stopped', frames, status: session.status(), residency: session.residencySnapshot() });

    expect(await session.suspendIdle(Date.now())).toEqual({ suspended: true });
    await vi.waitFor(async () => expect(await ownedChromePids(profileDir)).toHaveLength(0), { timeout: 8000 });
    expect(session.status().lifecycle).toBe('stopped');
    observations.push({ phase: 'idle-process-released', ownedChromePids: await ownedChromePids(profileDir), status: session.status() });

    // The registered service remains reusable; no permanent close or user Run
    // replay is involved in restoring its checkpointable page.
    await session.start('restored-window');
    // Old accessibility references must not execute against the reopened DOM.
    await expect(session.click(previousRef, { actor: 'user' })).rejects.toThrow();
    await session.stop('restored-window');
    expect((await session.snapshot()).length).toBeGreaterThan(0);
    expect(session.currentState().url).toBe(url);
    expect(session.status()).toMatchObject({ pageStateLost: true });
    expect(session.status().generation).toBeGreaterThan(initialGeneration);
    expect(cookieRequests.some((cookie) => cookie?.includes('residency=retained'))).toBe(true);
    observations.push({ phase: 'url-cookie-restored', staleReferenceRejected: true, status: session.status() });

    await session.click('#download', { actor: 'user' });
    await vi.waitFor(() => expect(session.residencySnapshot().protection).toBe('download'));
    expect(await session.suspendIdle(Date.now())).toMatchObject({ suspended: false, reason: 'download' });
    await vi.waitFor(() => expect(session.residencySnapshot().protection).not.toBe('download'), { timeout: 5000 });
    observations.push({ phase: 'download-protected', downloads: session.queryDownloads().length });

    await session.navigate(`${url}?fresh=1`, { actor: 'user' });
    await session.fillForm({ '#field': 'unsaved fixture input' }, { actor: 'user' });
    expect(await session.suspendIdle(Date.now())).toMatchObject({ suspended: false, reason: 'interaction' });
    observations.push({ phase: 'unsaved-input-protected', residency: session.residencySnapshot() });
    if (process.env.PIWIN_BROWSER_RESIDENCY_EVIDENCE) {
      await writeFile(process.env.PIWIN_BROWSER_RESIDENCY_EVIDENCE,
        JSON.stringify({ isolatedProfile: true, liveUserHost: false, observations }, null, 2));
    }
  } finally {
    unsubscribe(); await session.close();
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(profileDir, { recursive: true, force: true });
  }
}, 45_000);
