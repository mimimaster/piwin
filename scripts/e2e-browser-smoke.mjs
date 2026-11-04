#!/usr/bin/env node
/**
 * Real-Host browser smoke on an isolated root and profile.
 *
 * The installed piwin.app owns `~/.piwin/browser-profile`, so a second Chromium
 * cannot launch there. This script starts a Host on a temp root, points
 * `browser.profileDir` at the temp dir, and exercises the parts only a live
 * Chromium can prove: launch, one shared page across clients, lease survival,
 * and runtime release on the last stop.
 *
 * Skips (exit 0 with SKIP) when no Chromium/Chrome binary is available.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;
const { HostRuntime } = await import(join(repoRoot, 'packages/host-runtime/src/host-runtime.ts'));
const { getPiwinConfigPath } = await import(join(repoRoot, 'packages/host-runtime/src/paths.ts'));

const failures = [];
function assert(condition, label, detail) {
  if (condition) {
    console.log(`PASS ${label}`);
    return;
  }
  failures.push(label);
  console.log(`FAIL ${label}${detail === undefined ? '' : ` — ${String(detail)}`}`);
}

const SYSTEM_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (process.platform === 'darwin' && !existsSync(SYSTEM_CHROME)) {
  console.log('SKIP no Chrome/Chromium binary on this machine');
  process.exit(0);
}

const rootDir = await mkdtemp(join(tmpdir(), 'piwin-browser-smoke-'));
const profileDir = join(rootDir, 'browser-profile');
await writeFile(
  getPiwinConfigPath(rootDir),
  JSON.stringify({ browser: { headless: true, profileDir } }, null, 2),
);
process.env.PIWIN_ROOT = rootDir;
// An explicit binary-cache override shares only installed executables; the
// profile and every product write still stay inside this isolated root.

const pushes = [];
const framePushes = [];
const runtime = new HostRuntime({
  mode: 'sdk',
  mock: false,
  piwinRoot: rootDir,
  onPush: (message) => {
    pushes.push(message.type);
    if (message.type === 'browser/frame') framePushes.push(message);
  },
});
const waitFor = async (predicate, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
};

let leavingCleanly = false;
try {
  const ping = await runtime.handleCommand({ type: 'host/ping' });
  assert(ping.success === true, 'host/ping on an isolated root');

  const first = await runtime.handleCommand({ type: 'browser/start', leaseId: 'smoke-a' });
  assert(first.success === true, 'browser/start launches Chromium', first.error);
  if (first.success !== true) {
    throw new Error('browser did not start');
  }
  const firstState = first.data.state;
  assert(
    firstState.url === 'about:blank' || firstState.url.startsWith('file:'),
    'start returns a page state',
    JSON.stringify(firstState).slice(0, 200),
  );

  // `browser/navigate` refuses data:/javascript: URLs by design, so the page is
  // a real file on the isolated root.
  const pageFile = join(rootDir, 'smoke.html');
  await writeFile(pageFile, '<title>Smoke</title><h1>piwin smoke</h1>');
  const navigated = await runtime.handleCommand({
    type: 'browser/navigate',
    url: `file://${pageFile}`,
  });
  assert(navigated.success === true, 'browser/navigate opens a page', navigated.error);
  const pageUrl = navigated.success === true ? navigated.data.state.url : '';
  assert(pageUrl.startsWith('file:'), 'navigate reports the committed url', pageUrl);

  // The panel and the mini both render mirror frames; without a live JPEG
  // stream they have nothing to show.
  const gotFrame = await waitFor(() => framePushes.length > 0, 15_000);
  const firstFrame = framePushes[0];
  assert(gotFrame, 'mirror streams frames for the open page', pushes.join(','));
  assert(
    gotFrame && typeof firstFrame.byteLength === 'number' && firstFrame.byteLength > 0,
    'frame carries a real JPEG payload',
    JSON.stringify(firstFrame && { byteLength: firstFrame.byteLength, q: firstFrame.quality }),
  );

  // A second client must join the same page, not launch a second Chromium.
  const second = await runtime.handleCommand({ type: 'browser/start', leaseId: 'smoke-b' });
  assert(second.success === true, 'second client lease is accepted', second.error);
  assert(
    second.success === true && second.data.state.url === pageUrl,
    'second client sees the same page',
    second.success === true ? second.data.state.url : '',
  );

  const firstStop = await runtime.handleCommand({ type: 'browser/stop', leaseId: 'smoke-a' });
  assert(firstStop.success === true, 'first lease stops', firstStop.error);
  const survivor = await runtime.handleCommand({ type: 'browser/start', leaseId: 'smoke-b' });
  assert(
    survivor.success === true &&
      survivor.data.state.url === pageUrl,
    'the page survives one lease leaving',
    survivor.success === true ? survivor.data.state.url : survivor.error,
  );

  const lastStop = await runtime.handleCommand({ type: 'browser/stop', leaseId: 'smoke-b' });
  assert(lastStop.success === true, 'last lease stops', lastStop.error);

  // Chromium refuses a second launch on the same profile, so a successful
  // relaunch is proof the runtime was actually released.
  const relaunch = await runtime.handleCommand({ type: 'browser/start', leaseId: 'smoke-c' });
  assert(relaunch.success === true, 'runtime releases Chromium on the last stop', relaunch.error);
  if (relaunch.success === true) {
    await runtime.handleCommand({ type: 'browser/stop', leaseId: 'smoke-c' });
  }

  // A stopped workbench must not keep streaming: no frames after the last stop.
  const framesAtStop = framePushes.length;
  const noMoreFrames = !(await waitFor(() => framePushes.length > framesAtStop, 3_000));
  assert(noMoreFrames, 'frames stop with the last lease', String(framePushes.length - framesAtStop));

  const profileLock = join(profileDir, 'SingletonLock');
  assert(!existsSync(profileLock), 'no Chromium profile lock left behind', profileLock);
  // A conversation owns its page even while its shell is visiting another.
  const sessionA = 'browser-smoke-conversation-a';
  const sessionB = 'browser-smoke-conversation-b';
  const pageA = join(rootDir, 'conversation-a.html');
  const pageB = join(rootDir, 'conversation-b.html');
  const focusedInput = (text) => [
    { type: 'mouse', action: 'down', x: 20, y: 20, button: 'left' },
    { type: 'mouse', action: 'up', x: 20, y: 20, button: 'left' },
    { type: 'insertText', text },
  ];
  const form = (label) => `<title>${label}</title><input autofocus oninput="document.title='${label}:'+this.value">`;
  await writeFile(pageA, form('A'));
  await writeFile(pageB, form('B'));
  const startA = await runtime.handleCommand({ type: 'browser/start', sessionId: sessionA, leaseId: 'visit-a' });
  assert(startA.success, 'conversation A acquires its own browser', startA.error);
  await runtime.handleCommand({ type: 'browser/navigate', sessionId: sessionA, url: `file://${pageA}` });
  const inputA = await runtime.handleCommand({ type: 'browser/input', sessionId: sessionA, events: focusedInput('saved-a') });
  assert(inputA.success, 'conversation A accepts form input', inputA.error);
  const startB = await runtime.handleCommand({ type: 'browser/start', sessionId: sessionB, leaseId: 'visit-b' });
  assert(startB.success && startB.data.state.url === 'about:blank', 'conversation B starts blank instead of showing A');
  await runtime.handleCommand({ type: 'browser/navigate', sessionId: sessionB, url: `file://${pageB}` });
  const inputB = await runtime.handleCommand({ type: 'browser/input', sessionId: sessionB, events: focusedInput('saved-b') });
  assert(inputB.success, 'conversation B accepts form input', inputB.error);
  await runtime.handleCommand({ type: 'browser/stop', sessionId: sessionA, leaseId: 'visit-a' });
  const returnA = await runtime.handleCommand({ type: 'browser/start', sessionId: sessionA, leaseId: 'return-a' });
  assert(returnA.success && returnA.data.state.url === `file://${pageA}` && returnA.data.state.title === 'A:saved-a', 'returning to A preserves its page and form');
  await runtime.handleCommand({ type: 'browser/new-tab', sessionId: sessionA, url: `file://${pageA}` });
  const returnB = await runtime.handleCommand({ type: 'browser/start', sessionId: sessionB, leaseId: 'visit-b' });
  assert(returnB.success && returnB.data.state.url === `file://${pageB}` && returnB.data.state.title === 'B:saved-b', 'A navigation and tabs never change B', JSON.stringify(returnB));
  assert(await waitFor(() => framePushes.some((push) => push.sessionId === sessionA) && framePushes.some((push) => push.sessionId === sessionB), 10_000), 'live frames carry their conversation identity');
  await runtime.handleCommand({ type: 'browser/stop', sessionId: sessionA, leaseId: 'return-a' });
  await runtime.handleCommand({ type: 'browser/stop', sessionId: sessionB, leaseId: 'visit-b' });
  const scopedFramesAtStop = framePushes.length;
  assert(!(await waitFor(() => framePushes.length > scopedFramesAtStop, 1_000)), 'background conversations stop mirroring');
  await runtime.dispose();
  for (const sessionId of [sessionA, sessionB]) {
    const digest = createHash('sha256').update(sessionId).digest('hex');
    assert(!existsSync(join(profileDir, 'sessions', digest, 'SingletonLock')), `Host shutdown releases ${sessionId}`);
  }
  leavingCleanly = true;
} catch (error) {
  failures.push('smoke crashed');
  console.log(`FAIL smoke crashed — ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try {
    await runtime.dispose?.();
  } catch {
    /* dispose is best-effort on a crashed run */
  }
  if (leavingCleanly) {
    await rm(rootDir, { recursive: true, force: true });
  } else {
    console.log(`kept ${rootDir} for inspection`);
  }
}

if (failures.length > 0) {
  console.log(`\n${String(failures.length)} failure(s): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nbrowser smoke: all checks passed');
const config = await readFile(join(rootDir, 'config.json'), 'utf8').catch(() => null);
void config;
process.exit(0);
