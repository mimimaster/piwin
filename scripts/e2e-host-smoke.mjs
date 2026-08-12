#!/usr/bin/env node
/**
 * Host JSONL smoke (M4): ping → project open → session create/prompt mock → resume transcript.
 * Does not require Tauri or network.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostRuntime } from '../packages/host-runtime/src/host-runtime.ts';

const rootDir = await mkdtemp(join(tmpdir(), 'piwin-e2e-smoke-'));

try {
  process.env.PIWIN_MOCK = '1';
  const runtime = new HostRuntime({
    mode: 'sdk',
    mock: true,
    piwinRoot: rootDir,
  });

  const ping = await runtime.handleCommand({ type: 'host/ping' });
  assert(ping.success, 'host/ping failed');

  const projectPath = join(rootDir, 'demo-project');
  const opened = await runtime.handleCommand({ type: 'project/open', path: projectPath });
  assert(opened.success, 'project/open failed');

  const trusted = await runtime.handleCommand({ type: 'project/trust', path: projectPath });
  assert(trusted.success, 'project/trust failed');

  const created = await runtime.handleCommand({
    type: 'session/create',
    input: { projectPath, sessionName: 'e2e-smoke' },
  });
  assert(created.success, 'session/create failed');
  const sessionId = created.data.sessionId;
  assert(typeof sessionId === 'string' && sessionId.length > 0, 'missing sessionId');

  const prompted = await runtime.handleCommand({
    type: 'session/prompt',
    sessionId,
    input: { text: 'hello e2e smoke' },
  });
  assert(prompted.success, 'session/prompt failed');

  const resumed = await runtime.handleCommand({ type: 'session/resume', sessionId });
  assert(resumed.success, 'session/resume failed');
  const messages = resumed.data?.messages ?? [];
  assert(Array.isArray(messages) && messages.length > 0, 'resume returned no messages');
  assert(
    messages.some((message) => String(message.text ?? '').includes('hello e2e smoke')),
    'resume missing user prompt text',
  );

  const status = await runtime.handleCommand({ type: 'host/status' });
  assert(status.success, 'host/status failed');
  // Mock mode does not wire the session host tool port, so customTools is
  // intentionally false. Assert the stable mock identity instead.
  assert(status.data?.mock === true, 'sdk host/status expected mock=true');
  assert(status.data?.ready === true, 'sdk host/status expected ready=true');

  await runtime.dispose();
  console.log('e2e-host-smoke: ok');
} finally {
  await rm(rootDir, { recursive: true, force: true });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
