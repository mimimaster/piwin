#!/usr/bin/env node
/**
 * Step 1 spike: can a real Chrome + CDP drive a logged-in model web page?
 *
 * Throwaway by design. If the spike passes, the CDP client and the site
 * probing below get extracted into the extension (step 3); nothing here is
 * imported by product code.
 *
 * Zero dependencies: Node >= 22 global WebSocket + fetch, system Chrome.
 *
 * Usage:
 *   node cdp-spike.mjs launch              # start Chrome (persistent profile)
 *   node cdp-spike.mjs targets             # list page targets
 *   node cdp-spike.mjs open <url>          # open a tab, print its targetId
 *   node cdp-spike.mjs eval <targetId> <js> # Runtime.evaluate, print JSON result
 *   node cdp-spike.mjs shot <targetId> <path>
 *   node cdp-spike.mjs probe <targetId>    # site-agnostic state dump
 *   node cdp-spike.mjs status              # is Chrome up?
 *   node cdp-spike.mjs stop
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.PIWEB_SPIKE_PORT ?? 9333);
const PROFILE = join(homedir(), '.piwin', 'web-model', 'spike-profile');
const PIDFILE = join(homedir(), '.piwin', 'web-model', 'spike-chrome.pid');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdpVersion() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/version`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`/json/version HTTP ${response.status}`);
  return response.json();
}

async function cdpTargets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`/json/list HTTP ${response.status}`);
  return response.json();
}

/** Minimal CDP session over the page WebSocket. */
class CdpSession {
  #socket;
  #nextId = 1;
  #pending = new Map();

  static async attach(targetId) {
    const session = new CdpSession();
    await session.#connect(targetId);
    return session;
  }

  async #connect(targetId) {
    const targets = await cdpTargets();
    const target = targets.find((entry) => entry.id === targetId) ?? targets.find((entry) => entry.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error(`no page target for ${targetId}`);
    // A fresh Chrome may still be binding the inspector socket.
    let attempt = 0;
    for (;;) {
      try {
        this.#socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          this.#socket.addEventListener('open', resolve, { once: true });
          this.#socket.addEventListener('error', () => reject(new Error('ws error')), { once: true });
        });
        break;
      } catch (error) {
        if (++attempt >= 20) throw error;
        await sleep(250);
      }
    }
    this.#socket.addEventListener('message', (event) => {
      const payload = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      if (payload.id === undefined) return;
      const entry = this.#pending.get(payload.id);
      if (!entry) return;
      this.#pending.delete(payload.id);
      if (payload.error) entry.reject(new Error(`${payload.error.message} (${payload.error.code})`));
      else entry.resolve(payload.result);
    });
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate threw');
    }
    return result.result?.value;
  }

  close() {
    this.#socket?.close();
  }
}

/** Ask the page what it thinks it is, without assuming any site markup. */
const PROBE = String.raw`(() => {
  const body = document.body;
  const text = (body?.innerText ?? '').slice(0, 1200);
  const editables = [...document.querySelectorAll('[contenteditable="true"], textarea')]
    .map((node) => ({
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute('role') ?? null,
      aria: node.getAttribute('aria-label') ?? null,
      id: node.id || null,
      dataTestId: node.getAttribute('data-testid') ?? null,
      empty: (((node.tagName === 'TEXTAREA' ? node.value : node.innerText) ?? '')).trim().length === 0,
      classes: (node.className ?? '').toString().slice(0, 120),
    }))
    .slice(0, 8);
  const challenges = [...document.querySelectorAll('iframe')]
    .map((node) => node.src)
    .filter((src) => /challenges\.cloudflare\.com|turnstile|\/cdn-cgi\//.test(src));
  return {
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    textSample: text,
    editables,
    challengeFrames: challenges,
    signedOutHint: /log in|sign in|登录/i.test(text),
  };
})()`;

async function cmdLaunch() {
  await mkdir(PROFILE, { recursive: true });
  try {
    await cdpVersion();
    console.log(`chrome already listening on ${PORT}`);
    return;
  } catch {
    // not running yet
  }
  const child = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      // Keep automation markers out of the way; the profile and the window are real.
      '--disable-blink-features=AutomationControlled',
      '--window-size=1440,960',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  await writeFile(PIDFILE, String(child.pid), 'utf8');
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const version = await cdpVersion();
      console.log(`chrome ${version.Browser} listening on ${PORT} (pid ${child.pid})`);
      console.log(`profile: ${PROFILE}`);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('chrome did not expose the inspector within 15s');
}

async function cmdOpen(url) {
  const session = await CdpSession.attach('');
  const created = await session.send('Target.createTarget', { url });
  session.close();
  console.log(created.targetId);
}

async function cmdEval(targetId, expression) {
  const session = await CdpSession.attach(targetId);
  const value = await session.evaluate(expression);
  session.close();
  console.log(JSON.stringify(value, null, 2));
}

async function cmdProbe(targetId) {
  const session = await CdpSession.attach(targetId);
  const value = await session.evaluate(PROBE);
  session.close();
  console.log(JSON.stringify(value, null, 2));
}

async function cmdType(targetId, text) {
  const session = await CdpSession.attach(targetId);
  const focused = await session.evaluate(`(() => {
    const node = document.querySelector('[contenteditable="true"], textarea');
    if (!node) return false;
    node.focus();
    return document.activeElement === node;
  })()`);
  if (!focused) throw new Error('no composer to focus');
  await session.send('Input.insertText', { text });
  const readBack = await session.evaluate(`(() => {
    const node = document.querySelector('[contenteditable="true"], textarea');
    return ((node?.tagName === 'TEXTAREA' ? node.value : node?.innerText) ?? '').slice(0, 200);
  })()`);
  session.close();
  console.log(JSON.stringify({ focused, readBack }, null, 2));
}

async function cmdKey(targetId, key) {
  const session = await CdpSession.attach(targetId);
  for (const type of ['keyDown', 'keyUp']) {
    await session.send('Input.dispatchKeyEvent', {
      type,
      key,
      code: key === 'Enter' ? 'Enter' : undefined,
      windowsVirtualKeyCode: key === 'Enter' ? 13 : undefined,
      nativeVirtualKeyCode: key === 'Enter' ? 13 : undefined,
    });
  }
  session.close();
  console.log('sent');
}

async function cmdFront(targetId) {
  const session = await CdpSession.attach(targetId);
  await session.send('Target.activateTarget', { targetId }).catch(() => {});
  await session.send('Page.enable').catch(() => {});
  await session.send('Page.bringToFront').catch(() => {});
  session.close();
  console.log('fronted');
}

async function cmdShot(targetId, path) {
  const session = await CdpSession.attach(targetId);
  const shot = await session.send('Page.enable').then(() => session.send('Page.captureScreenshot', { format: 'png' }));
  session.close();
  await writeFile(path, Buffer.from(shot.data, 'base64'));
  console.log(path);
}

async function cmdTargets() {
  const targets = await cdpTargets();
  for (const target of targets) {
    if (target.type !== 'page') continue;
    console.log(`${target.id}\t${target.url}`);
  }
}

async function main() {
  const [command, a, b] = process.argv.slice(2);
  switch (command) {
    case 'launch':
      return cmdLaunch();
    case 'status': {
      const version = await cdpVersion();
      console.log(`${version.Browser} on ${PORT}`);
      return;
    }
    case 'targets':
      return cmdTargets();
    case 'open':
      return cmdOpen(a);
    case 'eval':
      return cmdEval(a, b);
    case 'probe':
      return cmdProbe(a);
    case 'type':
      return cmdType(a, b);
    case 'front':
      return cmdFront(a);
    case 'key':
      return cmdKey(a, b);
    case 'shot':
      return cmdShot(a, b);
    case 'stop': {
      const session = await CdpSession.attach('');
      await session.send('Browser.close').catch(() => {});
      session.close();
      console.log('close requested');
      return;
    }
    default:
      console.log(await import('node:fs/promises').then((fs) => fs.readFile(new URL(import.meta.url), 'utf8')).then((text) => text.split('\n').slice(2, 24).join('\n')));
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`spike failed: ${error.message}`);
  process.exitCode = 1;
});
