/**
 * Source of the hang watchdog thread, run as an `eval` worker so the bundled
 * sidecar (`host-serve.mjs`) needs no extra file beside it.
 *
 * Why a thread: when the main event loop is blocked (sync loop, GC thrash
 * near the heap limit) no main-thread timer or console write runs, so only a
 * separate thread can notice and record it. The worker therefore appends to
 * `host.log` itself instead of going through `console`, whose worker output
 * is relayed by the (blocked) main thread.
 *
 * Heartbeat layout (BigInt64Array over `workerData.heartbeat`), written by the
 * main thread once per beat: [0] beat time (epoch ms), [1] main heap used
 * bytes, [2] main heap limit bytes.
 */
export const HOST_HANG_WATCHDOG_WORKER_SOURCE = String.raw`
'use strict';
const { workerData } = require('node:worker_threads');
const { appendFileSync, mkdirSync } = require('node:fs');
const { execFile } = require('node:child_process');
const { join } = require('node:path');

const settings = workerData;
const beat = new BigInt64Array(settings.heartbeat);
const MIB = 1024 * 1024;

let episodeStartedAt = 0;
let maxLagMs = 0;
let nextStillBlockedLogAt = 0;
let capturedThisEpisode = false;
let capturesTaken = 0;
let lastPollAt = Date.now();

function write(line) {
  const stamped = '[' + new Date().toISOString() + '] [piwin host watchdog] ' + line + '\n';
  try {
    appendFileSync(settings.logFilePath, stamped);
  } catch (error) {
    // host.log is unwritable; stderr is the only other sink this thread has
    // (relayed once the main thread runs again).
    process.stderr.write(stamped);
  }
}

function memory() {
  const heapUsed = Number(Atomics.load(beat, 1));
  const heapLimit = Number(Atomics.load(beat, 2));
  return (
    'rss=' + Math.round(process.memoryUsage.rss() / MIB) + 'MiB' +
    ' mainHeapUsed=' + Math.round(heapUsed / MIB) + 'MiB' +
    ' mainHeapLimit=' + Math.round(heapLimit / MIB) + 'MiB (at last beat)'
  );
}

function captureNativeStack(lagMs) {
  if (capturesTaken >= settings.maxCaptures) {
    write('stack sample skipped: already captured ' + capturesTaken + ' this run');
    return;
  }
  if (settings.platform !== 'darwin') {
    write('stack sample skipped: no native sampler on ' + settings.platform);
    return;
  }
  capturesTaken += 1;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(settings.diagnosticsDir, 'host-hang-' + settings.pid + '-' + stamp + '.sample.txt');
  try {
    mkdirSync(settings.diagnosticsDir, { recursive: true });
  } catch (error) {
    write('stack sample skipped: ' + (error && error.message));
    return;
  }
  write('capturing native stack sample of pid=' + settings.pid + ' (blocked ' + lagMs + 'ms)');
  execFile(
    '/usr/bin/sample',
    [String(settings.pid), String(settings.sampleSeconds), '-file', file],
    { timeout: (settings.sampleSeconds + 20) * 1000 },
    (error) => {
      write(error ? 'stack sample failed: ' + error.message : 'stack sample written: ' + file);
    },
  );
}

function poll() {
  const now = Date.now();
  const pollGap = now - lastPollAt;
  lastPollAt = now;
  // This thread was itself frozen (system sleep): the main loop was frozen
  // with it, so the gap says nothing about the main thread.
  if (pollGap > settings.pollMs * 4) return;

  const lagMs = now - Number(Atomics.load(beat, 0));
  if (episodeStartedAt === 0) {
    if (lagMs < settings.blockedMs) return;
    episodeStartedAt = now - lagMs;
    maxLagMs = lagMs;
    capturedThisEpisode = false;
    nextStillBlockedLogAt = now + settings.repeatMs;
    write('main event loop blocked for ' + lagMs + 'ms ' + memory());
    return;
  }
  if (lagMs < settings.blockedMs) {
    write('main event loop recovered after ~' + maxLagMs + 'ms blocked ' + memory());
    episodeStartedAt = 0;
    return;
  }
  maxLagMs = Math.max(maxLagMs, lagMs);
  if (!capturedThisEpisode && lagMs >= settings.captureAfterMs) {
    capturedThisEpisode = true;
    captureNativeStack(lagMs);
  }
  if (now >= nextStillBlockedLogAt) {
    nextStillBlockedLogAt = now + settings.repeatMs;
    write('main event loop still blocked for ' + lagMs + 'ms ' + memory());
  }
}

setInterval(poll, settings.pollMs);
`;
