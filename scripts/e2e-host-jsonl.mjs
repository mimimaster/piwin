#!/usr/bin/env node
/**
 * E3 — real host-serve JSONL integration harness.
 *
 * Spawns the same `piwin host serve --mode sdk --mock` command topology used by
 * the Tauri sidecar and exercises stdin/stdout JSONL framing, control-lane
 * priority, delayed-run abort, and bounded clean shutdown.
 *
 * Protocol:
 *   stdin  ← HostCommand       (one JSON object per line)
 *   stdout → HostServerMessage  (HostResponse | HostPush)
 *
 * Usage:
 *   node scripts/e2e-host-jsonl.mjs
 *
 * Accepts optional DEBUG=e2e-host-jsonl for verbose logging.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { exit } from 'node:process';
import { randomUUID } from 'node:crypto';

// ── utilities ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const isDebug = process.env.DEBUG?.includes('e2e-host-jsonl');

function assert(condition, message) {
  if (!condition) {
    failed += 1;
    const error = new Error(`FAIL: ${message}`);
    error.name = 'AssertionError';
    throw error;
  }
  passed += 1;
}

function debug(...args) {
  if (isDebug) {
    const prefix = new Date().toISOString().slice(11, 23);
    console.error(`[e2e-host-jsonl ${prefix}]`, ...args);
  }
}

function fail(message) {
  failed += 1;
  const error = new Error(`FAIL: ${message}`);
  error.name = 'AssertionError';
  throw error;
}

// ── main harness ─────────────────────────────────────────────────

async function runTestSequence(child, piwinRoot) {
  const stderrChunks = [];
  let childExitCode = null;

  child.stderr.on('data', (chunk) => {
    stderrChunks.push(chunk);
    if (isDebug) process.stderr.write(chunk);
  });
  child.on('exit', (code) => { childExitCode = code; });

  // ── stdout reader ──────────────────────────────────────────────
  const seenLines = [];          // ordered list of all parsed messages
  const pendingResolvers = [];   // [{ id, resolve, timer }]
  const eventLog = [];           // non-response push events
  const eventListeners = [];     // [{ predicate, resolve, timer }]

  const stdoutReader = createInterface({ input: child.stdout, crlfDelay: Infinity });

  stdoutReader.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      fail(`non-JSON stdout line: ${trimmed.slice(0, 200)}`);
      return;
    }

    seenLines.push(parsed);

    if (parsed.type === 'response') {
      debug('response:', parsed.command, parsed.success, 'id:', parsed.id);
      // Notify matching pending resolver.
      for (let idx = 0; idx < pendingResolvers.length; idx += 1) {
        const entry = pendingResolvers[idx];
        if (entry.id === parsed.id) {
          clearTimeout(entry.timer);
          entry.resolve(parsed);
          pendingResolvers.splice(idx, 1);
          idx -= 1;
        }
      }
    } else {
      debug('push:', parsed.type, 'event:', parsed.event?.type ?? '');
      eventLog.push(parsed);
      // Notify matching event listener.
      for (let idx = 0; idx < eventListeners.length; idx += 1) {
        const entry = eventListeners[idx];
        if (entry.predicate(parsed)) {
          clearTimeout(entry.timer);
          entry.resolve(parsed);
          eventListeners.splice(idx, 1);
          idx -= 1;
        }
      }
    }
  });

  // ── helpers ────────────────────────────────────────────────────

  function writeCommand(command) {
    const id = command.id || randomUUID();
    const withId = { ...command, id };
    child.stdin.write(`${JSON.stringify(withId)}\n`);
    debug('write:', command.type, id);
    return id;
  }

  function waitForResponse(id, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from pendingResolvers if still present.
        for (let idx = 0; idx < pendingResolvers.length; idx += 1) {
          if (pendingResolvers[idx].id === id) {
            pendingResolvers.splice(idx, 1);
            break;
          }
        }
        reject(new Error(`response timeout for ${id} after ${timeoutMs}ms`));
      }, timeoutMs);

      pendingResolvers.push({ id, resolve, timer });
    });
  }

  function waitForEvent(predicate, timeoutMs = 20_000) {
    // Check events already received.
    for (const event of eventLog) {
      if (predicate(event)) return event;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        for (let idx = 0; idx < eventListeners.length; idx += 1) {
          if (eventListeners[idx].timer === timer) {
            eventListeners.splice(idx, 1);
            break;
          }
        }
        reject(new Error(`event predicate timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      eventListeners.push({ predicate, resolve, timer });
    });
  }

  // ── hard cleanup ───────────────────────────────────────────────
  let cleanedUp = false;

  async function cleanup(success = true) {
    if (cleanedUp) return;
    cleanedUp = true;
    debug('cleanup (success=%s)', success);

    // Close stdin to signal EOF and let the dispatcher drain.
    try { child.stdin.end(); } catch { /* ignore */ }

    // Wait for graceful exit (up to 5 seconds).
    if (childExitCode === null) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && childExitCode === null) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Hard kill if still alive.
    if (childExitCode === null) {
      child.kill('SIGKILL');
      await new Promise((r) => setTimeout(r, 200));
    }

    // Remove temp directory.
    await rm(piwinRoot, { recursive: true, force: true }).catch(() => {});

    const stderrText = Buffer.concat(stderrChunks).toString('utf8');
    if (!success) {
      console.error('--- stderr from sidecar ---');
      console.error(stderrText);
    }
    debug('cleanup done. exit code:', childExitCode);
  }

  // ── test sequence ──────────────────────────────────────────────
  let harnessFailed = false;

  try {
    // ── 1. Wait for initial host/status push ─────────────────────
    debug('step 1: waiting for host/status push ...');
    const initialStatus = await waitForEvent(
      (push) => push.type === 'host/status',
      10_000,
    );
    assert(initialStatus?.ready === true, 'host/status ready');
    assert(initialStatus?.mock === true, 'host/status mock=true');
    assert(initialStatus?.mode === 'sdk', 'host/status mode=sdk');
    debug('host/status received: ready=%s mock=%s', initialStatus.ready, initialStatus.mock);

    // ── 2. host/ping ─────────────────────────────────────────────
    debug('step 2: host/ping ...');
    const pingId = writeCommand({ type: 'host/ping' });
    const pingResponse = await waitForResponse(pingId, 5_000);
    assert(pingResponse.success === true, 'host/ping success');
    debug('host/ping ok');

    // ── 3. project/open ─────────────────────────────────────────
    debug('step 3: project/open ...');
    const projectPath = join(piwinRoot, 'demo-project');
    const openId = writeCommand({ type: 'project/open', path: projectPath });
    const openResponse = await waitForResponse(openId, 5_000);
    assert(openResponse.success === true, 'project/open success');
    debug('project/open ok');

    // ── 4. project/trust ─────────────────────────────────────────
    debug('step 4: project/trust ...');
    const trustId = writeCommand({ type: 'project/trust', path: projectPath });
    const trustResponse = await waitForResponse(trustId, 5_000);
    assert(trustResponse.success === true, 'project/trust success');
    debug('project/trust ok');

    // ── 5. session/create ────────────────────────────────────────
    debug('step 5: session/create ...');
    const createId = writeCommand({
      type: 'session/create',
      input: { projectPath, sessionName: 'e2e-host-jsonl' },
    });
    const createResponse = await waitForResponse(createId, 10_000);
    assert(createResponse.success === true, 'session/create success');
    const sessionId = createResponse.data?.sessionId;
    assert(typeof sessionId === 'string' && sessionId.length > 0, 'session/create returned sessionId');
    debug('session created:', sessionId);

    // ── 6. session/prompt (should ack within 250ms) ──────────────
    debug('step 6: session/prompt (delayed, expect ack < 250ms) ...');
    const promptSentAt = Date.now();
    const promptId = writeCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'e2e host jsonl prompt' },
    });
    const promptResponse = await waitForResponse(promptId, 5_000);
    const promptAckMs = Date.now() - promptSentAt;
    assert(promptResponse.success === true, 'session/prompt success (ack)');
    assert(promptAckMs < 250, `prompt ack in ${promptAckMs}ms (expected < 250ms)`);
    const acceptedData = promptResponse.data;
    assert(
      acceptedData?.runId && typeof acceptedData.runId === 'string',
      'prompt response has runId',
    );
    assert(
      acceptedData?.sessionId === sessionId,
      'prompt response sessionId matches',
    );
    assert(
      acceptedData?.acceptedAt && typeof acceptedData.acceptedAt === 'string',
      'prompt response has acceptedAt',
    );
    const runId = acceptedData.runId;
    debug('prompt acked in %dms runId=%s', promptAckMs, runId);

    // ── 7. Send session/abort and host/status before terminal ────
    debug('step 7: sending session/abort + host/status before terminal ...');
    const abortSentAt = Date.now();
    const abortId = writeCommand({
      type: 'session/abort',
      sessionId,
      runId,
    });
    const abortResponse = await waitForResponse(abortId, 5_000);
    const abortAckMs = Date.now() - abortSentAt;
    // The abort reaches the control lane immediately (no serial queue).
    assert(abortAckMs <= 250, `abort ack in ${abortAckMs}ms (expected <= 250ms)`);
    assert(abortResponse.success === true, 'session/abort success (ack)');
    assert(abortResponse.id === abortId, 'abort response id matches request');
    debug('abort acked in %dms', abortAckMs);

    // Send host/status while the aborted run is still draining.
    // This must be processed by the control lane before the prompt terminal.
    const statusId = writeCommand({ type: 'host/status' });
    const statusResponse = await waitForResponse(statusId, 5_000);
    assert(statusResponse.success === true, 'host/status success during abort');
    assert(statusResponse.id === statusId, 'host/status response id matches request');
    debug('host/status ok during abort');

    // ── 8. Wait for exactly one terminal event ───────────────────
    debug('step 8: waiting for run/terminal event ...');
    const terminalEvent = await waitForEvent(
      (push) =>
        push.type === 'event' &&
        push.event?.type === 'run/terminal' &&
        push.event?.runId === runId,
      15_000,
    );
    const cancelTerminalMs = Date.now() - abortSentAt;
    assert(terminalEvent != null, 'run/terminal event received');
    const terminalOutcome = terminalEvent.event.outcome;
    assert(
      terminalOutcome === 'cancelled',
      `run terminal outcome is 'cancelled' (got '${terminalOutcome}')`,
    );
    assert(
      cancelTerminalMs <= 1_000,
      `cancel terminal in ${cancelTerminalMs}ms (expected <= 1000ms)`,
    );
    debug(
      'run/terminal: outcome=%s code=%s cancelTerminalMs=%d',
      terminalOutcome,
      terminalEvent.event.code,
      cancelTerminalMs,
    );

    // Verify exactly one terminal event for this run.
    const terminalEventsForRun = eventLog.filter(
      (push) =>
        push.type === 'event' &&
        push.event?.type === 'run/terminal' &&
        push.event?.runId === runId,
    );
    assert(
      terminalEventsForRun.length === 1,
      `exactly 1 run/terminal event for run ${runId} (got ${terminalEventsForRun.length})`,
    );

    // Verify abort and status responses arrived BEFORE the terminal event.
    const abortResponseIdx = seenLines.indexOf(abortResponse);
    const statusResponseIdx = seenLines.indexOf(statusResponse);
    const terminalEventIdx = seenLines.indexOf(terminalEvent);
    assert(abortResponseIdx >= 0, 'abort response found in output stream');
    assert(terminalEventIdx >= 0, 'terminal event found in output stream');
    assert(
      abortResponseIdx < terminalEventIdx,
      'abort response arrived before run/terminal event',
    );
    assert(
      statusResponseIdx < terminalEventIdx,
      'host/status response arrived before run/terminal event',
    );

    // ── 9. Close stdin → bounded clean exit ──────────────────────
    debug('step 9: stdin EOF -> bounded clean exit ...');
    const closeSent = Date.now();
    child.stdin.end();

    // Wait for exit with timeout.
    const exitTimeoutMs = 10_000;
    const deadline = Date.now() + exitTimeoutMs;
    while (Date.now() < deadline && childExitCode === null) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const shutdownMs = Date.now() - closeSent;
    assert(childExitCode === 0, `child exit code 0 (got ${childExitCode})`);
    debug('child exited with code 0 in %dms', shutdownMs);

    debug('ALL ASSERTIONS PASSED (%d passed, %d failed)', passed, failed);
  } catch (error) {
    harnessFailed = true;
    console.error('HARNESS ERROR:', error.message);
  } finally {
    if (!harnessFailed) {
      await cleanup(true);
    } else {
      await cleanup(false);
    }
  }

  return { harnessFailed, passed, failed };
}

// ── malformed JSON test (separate sub-sequence) ──────────────────

async function testMalformedJson(piwinRoot) {
  debug('  spawning child for malformed JSON test ...');
  const child = spawn(
    'pnpm',
    [
      '--filter', '@piwin/cli',
      'exec', 'tsx',
      'src/index.ts',
      'host', 'serve',
      '--mode', 'sdk',
      '--mock',
    ],
    {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PIWIN_MOCK: '1',
        PIWIN_ROOT: piwinRoot,
        NODE_ENV: 'test',
      },
    },
  );

  const stdoutLines = [];
  const lineReader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lineReader.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed) stdoutLines.push(trimmed);
  });

  // Wait for host/status to confirm readiness.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout waiting for host/status in malformed test')),
      10_000,
    );
    const poll = () => {
      if (stdoutLines.some((l) => l.includes('"host/status"'))) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  // Send a malformed JSON line.
  child.stdin.write('this is not json\n');

  // Wait for the error response.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout waiting for error response in malformed test')),
      5_000,
    );
    const poll = () => {
      if (stdoutLines.some((l) => l.includes('invalid JSON'))) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  // Verify the error response format.
  const errorLine = stdoutLines.find((l) => l.includes('invalid JSON'));
  assert(errorLine != null, 'malformed JSON produces error response');
  let errorResponse;
  try {
    errorResponse = JSON.parse(errorLine);
  } catch {
    fail(`error response is valid JSON: ${errorLine.slice(0, 200)}`);
  }
  assert(errorResponse.type === 'response', 'error response has type=response');
  assert(errorResponse.success === false, 'error response has success=false');
  assert(
    typeof errorResponse.error === 'string' && errorResponse.error.length > 0,
    'error response has error message',
  );
  debug('malformed JSON error response ok:', errorResponse.error);

  // Clean shutdown.
  child.stdin.end();
  let childExitCode = null;
  child.on('exit', (code) => { childExitCode = code; });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && childExitCode === null) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (childExitCode === null) {
    child.kill('SIGKILL');
  }

  debug('malformed JSON test: child exit code =', childExitCode);
  assert(
    childExitCode === 0 || childExitCode === null,
    `malformed JSON child exit code 0 or null (got ${childExitCode})`,
  );
  debug('malformed JSON test done');
}

// ── E4: mcp/status smoke test ──────────────────────────────────

async function testMcpStatus(piwinRoot) {
  debug('  spawning child for mcp/status smoke test ...');
  const child = spawn(
    'pnpm',
    [
      '--filter', '@piwin/cli',
      'exec', 'tsx',
      'src/index.ts',
      'host', 'serve',
      '--mode', 'sdk',
      '--mock',
    ],
    {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PIWIN_MOCK: '1',
        PIWIN_ROOT: piwinRoot,
        NODE_ENV: 'test',
      },
    },
  );

  const stdoutLines = [];
  const lineReader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lineReader.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed) stdoutLines.push(trimmed);
  });

  // Wait for host/status push.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout waiting for host/status in mcp test')),
      10_000,
    );
    const poll = () => {
      if (stdoutLines.some((l) => l.includes('"host/status"'))) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  // Send mcp/status.
  const mcpId = randomUUID();
  child.stdin.write(JSON.stringify({ id: mcpId, type: 'mcp/status' }) + '\n');

  // Wait for the response.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout waiting for mcp/status response')),
      5_000,
    );
    const poll = () => {
      const responseLine = stdoutLines.find(
        (l) => l.includes(mcpId) && l.includes('"response"'),
      );
      if (responseLine) {
        clearTimeout(timer);
        resolve(responseLine);
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  const responseLine = stdoutLines.find(
    (l) => l.includes(mcpId) && l.includes('"response"'),
  );
  assert(responseLine != null, 'mcp/status response received');
  const parsed = JSON.parse(responseLine);
  assert(parsed.success === true, 'mcp/status success');
  assert(parsed.type === 'response', 'mcp/status type=response');
  assert(
    parsed.data?.servers !== undefined && Array.isArray(parsed.data.servers),
    'mcp/status data.servers is array',
  );
  for (const server of parsed.data.servers) {
    assert(
      typeof server.serverId === 'string',
      'mcp/status server has serverId string',
    );
    assert(
      typeof server.status === 'string',
      'mcp/status server has status string',
    );
  }
  debug('mcp/status returned %d servers', parsed.data.servers.length);

  // Clean shutdown.
  child.stdin.end();
  let childExitCode = null;
  child.on('exit', (code) => { childExitCode = code; });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && childExitCode === null) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (childExitCode === null) {
    child.kill('SIGKILL');
  }

  debug('mcp/status smoke test done');
}

// ── E4: permission/resolve smoke test ──────────────────────────

async function testPermissionResolve(piwinRoot) {
  debug('  spawning child for permission/resolve smoke test ...');
  const child = spawn(
    'pnpm',
    [
      '--filter', '@piwin/cli',
      'exec', 'tsx',
      'src/index.ts',
      'host', 'serve',
      '--mode', 'sdk',
      '--mock',
    ],
    {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PIWIN_MOCK: '1',
        PIWIN_ROOT: piwinRoot,
        NODE_ENV: 'test',
      },
    },
  );

  const stdoutLines = [];
  const lineReader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lineReader.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed) stdoutLines.push(trimmed);
  });

  // Wait for host/status push.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout waiting for host/status in permission test')),
      10_000,
    );
    const poll = () => {
      if (stdoutLines.some((l) => l.includes('"host/status"'))) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  // Resolve a non-existent permission request (idempotent).
  const resolveId = randomUUID();
  child.stdin.write(
    JSON.stringify({
      id: resolveId,
      type: 'permission/resolve',
      requestId: 'definitely-nonexistent-request-id',
      decision: 'deny',
    }) + '\n',
  );

  // Wait for the response.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout waiting for permission/resolve response')),
      5_000,
    );
    const poll = () => {
      const responseLine = stdoutLines.find(
        (l) => l.includes(resolveId) && l.includes('"response"'),
      );
      if (responseLine) {
        clearTimeout(timer);
        resolve(responseLine);
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  const responseLine = stdoutLines.find(
    (l) => l.includes(resolveId) && l.includes('"response"'),
  );
  assert(responseLine != null, 'permission/resolve response received');
  const parsed = JSON.parse(responseLine);
  // The resolve is idempotent - it succeeds even if the request doesn't exist
  // (it just returns success = false, or true if the host accepted the no-op).
  assert(parsed.type === 'response', 'permission/resolve type=response');
  debug('permission/resolve: success=%s', parsed.success);

  // Clean shutdown.
  child.stdin.end();
  let childExitCode = null;
  child.on('exit', (code) => { childExitCode = code; });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && childExitCode === null) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (childExitCode === null) {
    child.kill('SIGKILL');
  }

  debug('permission/resolve smoke test done');
}

// ── E4: high-rate retained-output pressure test ─────────────────

async function testHighRateOutput(piwinRoot) {
  debug('  spawning child for high-rate output test ...');
  const child = spawn(
    'pnpm',
    [
      '--filter', '@piwin/cli',
      'exec', 'tsx',
      'src/index.ts',
      'host', 'serve',
      '--mode', 'sdk',
      '--mock',
      '--test-fixture', 'high-rate-tool-output',
    ],
    {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PIWIN_MOCK: '1',
        PIWIN_ROOT: piwinRoot,
        NODE_ENV: 'test',
      },
    },
  );

  const stdoutLines = [];
  const lineReader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lineReader.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed) stdoutLines.push(trimmed);
  });

  // Wait for host/status push.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout waiting for host/status in high-rate test')),
      10_000,
    );
    const poll = () => {
      if (stdoutLines.some((l) => l.includes('"host/status"'))) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  // Create project + session.
  const projectPath = join(piwinRoot, 'highrate-proj');
  const openId = randomUUID();
  child.stdin.write(JSON.stringify({ id: openId, type: 'project/open', path: projectPath }) + '\n');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout project/open in high-rate test')), 5_000);
    const poll = () => {
      if (stdoutLines.some((l) => l.includes(openId) && l.includes('"response"'))) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  const trustId = randomUUID();
  child.stdin.write(JSON.stringify({ id: trustId, type: 'project/trust', path: projectPath }) + '\n');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout project/trust in high-rate test')), 5_000);
    const poll = () => {
      if (stdoutLines.some((l) => l.includes(trustId) && l.includes('"response"'))) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  const createId = randomUUID();
  child.stdin.write(
    JSON.stringify({
      id: createId,
      type: 'session/create',
      input: { projectPath, sessionName: 'highrate-e2e' },
    }) + '\n',
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout session/create in high-rate test')), 10_000);
    const poll = () => {
      if (stdoutLines.some((l) => l.includes(createId) && l.includes('"response"'))) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  const createResponseLine = stdoutLines.find(
    (l) => l.includes(createId) && l.includes('"response"'),
  );
  const createResponse = JSON.parse(createResponseLine);
  const sessionId = createResponse.data?.sessionId;
  assert(typeof sessionId === 'string', 'high-rate test session created with sessionId');

  // Send prompt through the fixture. It emits 10 MiB of tool/update events;
  // the JSONL sidecar may coalesce its deltas, but HostRuntime's product
  // transcript must retain its bounded tool output and terminal lifecycle.
  const promptId = randomUUID();
  child.stdin.write(
    JSON.stringify({
      id: promptId,
      type: 'session/prompt',
      sessionId,
      input: { text: 'generate high-rate output' },
    }) + '\n',
  );

  // Wait for prompt ack.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout prompt ack in high-rate test')), 5_000);
    const poll = () => {
      if (stdoutLines.some((l) => l.includes(promptId) && l.includes('"response"'))) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(poll, 20);
      }
    };
    poll();
  });

  // Wait for run/terminal event.
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timeout run/terminal in high-rate test')),
      15_000,
    );
    const poll = () => {
      if (stdoutLines.some((l) => l.includes('run/terminal'))) {
        clearTimeout(timer);
        resolve();
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });

  // Verify terminal event is well-formed.
  const terminalLine = stdoutLines.find((l) => l.includes('run/terminal'));
  assert(terminalLine != null, 'high-rate test: run/terminal event received');
  const terminalParsed = JSON.parse(terminalLine);
  assert(
    terminalParsed.event?.type === 'run/terminal',
    'high-rate test: terminal event has type=run/terminal',
  );
  assert(
    typeof terminalParsed.event?.runId === 'string',
    'high-rate test: terminal event has runId',
  );
  assert(
    typeof terminalParsed.event?.outcome === 'string',
    'high-rate test: terminal event has outcome',
  );
  assert(
    terminalParsed.event?.outcome === 'completed',
    `high-rate test: terminal outcome is 'completed' (got '${terminalParsed.event.outcome}')`,
  );
  debug('high-rate test: terminal event outcome=%s', terminalParsed.event.outcome);

  const messageId = randomUUID();
  child.stdin.write(JSON.stringify({ id: messageId, type: 'session/messages', sessionId }) + '\n');
  const retentionDeadline = Date.now() + 15_000;
  let transcriptResponse;
  while (Date.now() < retentionDeadline) {
    const responseLine = stdoutLines.find(
      (line) => line.includes(messageId) && line.includes('output truncated: retention limit reached'),
    );
    if (responseLine) {
      transcriptResponse = JSON.parse(responseLine);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    child.stdin.write(JSON.stringify({ id: messageId, type: 'session/messages', sessionId }) + '\n');
  }
  assert(transcriptResponse?.success === true, 'high-rate test: transcript response succeeds');
  const assistant = transcriptResponse?.data?.messages?.find(
    (message) => message.role === 'assistant',
  );
  const toolOutput = assistant?.tools?.find(
    (tool) => tool.toolName === 'delayed_fixture_tool',
  )?.output;
  assert(
    typeof toolOutput === 'string' && toolOutput.includes('[output truncated: retention limit reached]'),
    'high-rate test: transcript retained tool output has truncation marker',
  );
  assert(
    Buffer.byteLength(toolOutput ?? '', 'utf8') <= 256 * 1024,
    'high-rate test: retained tool output is bounded to 256 KiB',
  );
  assert(
    assistant?.tools?.[0]?.status === 'done',
    'high-rate test: retained tool lifecycle completed after truncation',
  );

  // Clean shutdown.
  child.stdin.end();
  let childExitCode = null;
  child.on('exit', (code) => { childExitCode = code; });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && childExitCode === null) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (childExitCode === null) {
    child.kill('SIGKILL');
  }

  debug('high-rate output test done, exit code: %s', childExitCode);
}

// ── main ─────────────────────────────────────────────────────────

async function main() {
  const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-e2e-jsonl-'));
  debug('piwinRoot:', piwinRoot);

  const child = spawn(
    'pnpm',
    [
      '--filter', '@piwin/cli',
      'exec', 'tsx',
      'src/index.ts',
      'host', 'serve',
      '--mode', 'sdk',
      '--mock',
      '--test-fixture', 'hang-until-abort',
    ],
    {
      cwd: join(import.meta.dirname, '..'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PIWIN_MOCK: '1',
        PIWIN_ROOT: piwinRoot,
        NODE_ENV: 'test',
      },
    },
  );

  const { harnessFailed } = await runTestSequence(child, piwinRoot);

  // ── 10. Malformed JSON input (separate child) ──────────────────
  if (!harnessFailed) {
    debug('step 10: malformed JSON input (separate process) ...');
    await testMalformedJson(piwinRoot);
  }

  // ── 11. mcp/status (control lane non-session command) ─────────
  if (!harnessFailed) {
    debug('step 11: mcp/status (separate process) ...');
    await testMcpStatus(piwinRoot);
  }

  // ── 12. Permission resolve (idempotent non-session command) ────
  if (!harnessFailed) {
    debug('step 12: permission/resolve (separate process) ...');
    await testPermissionResolve(piwinRoot);
  }

  // ── 13. High-rate output retention and truncation  ──────────────
  if (!harnessFailed) {
    debug('step 13: high-rate retained-output pressure (separate process) ...');
    await testHighRateOutput(piwinRoot);
  }

  // ── report ─────────────────────────────────────────────────────
  console.log('');
  console.log('=== E3 host-serve JSONL harness report (E4 expanded) ===');
  console.log('assertions passed:', passed);
  console.log('assertions failed:', failed);
  if (failed > 0 || harnessFailed) {
    console.error('HARNESS FAILED -- see errors above');
    exit(1);
  }
  console.log('E3 host-serve JSONL harness (E4 expanded): PASSED');
  exit(0);
}

main().catch((error) => {
  console.error('UNHANDLED ERROR:', error);
  exit(1);
});
