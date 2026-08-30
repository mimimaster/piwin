import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { createAttachedCliCommandHandler, openCliHost } from './cli-host.js';

describe('openCliHost', () => {
  const previousUrl = process.env.PIWIN_HOST_URL;
  const previousToken = process.env.PIWIN_HOST_TOKEN;

  afterEach(() => {
    if (previousUrl === undefined) {
      delete process.env.PIWIN_HOST_URL;
    } else {
      process.env.PIWIN_HOST_URL = previousUrl;
    }
    if (previousToken === undefined) {
      delete process.env.PIWIN_HOST_TOKEN;
    } else {
      process.env.PIWIN_HOST_TOKEN = previousToken;
    }
  });

  it('opens an in-process Host when PIWIN_HOST_URL is unset', async () => {
    delete process.env.PIWIN_HOST_URL;
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cli-host-'));
    const host = await openCliHost({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      expect(host.transport).toBe('in-process');
      const ping = await host.handleCommand({ type: 'host/ping' });
      expect(ping.success).toBe(true);
    } finally {
      await host.dispose();
    }
  });

  it('forwards caller-owned keys to in-process HostRuntime', async () => {
    delete process.env.PIWIN_HOST_URL;
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-cli-host-key-'));
    const host = await openCliHost({ mode: 'sdk', mock: true, piwinRoot: rootDir });
    try {
      const missing = await host.handleCommand({
        type: 'flashcards/study/start',
        mode: 'scheduled',
        scope: { kind: 'all' },
        resumeExisting: true,
      });
      expect(missing).toMatchObject({
        success: false,
        problem: { code: 'idempotency-key-required' },
      });
      const withKey = await host.handleCommand(
        {
          type: 'flashcards/study/start',
          mode: 'scheduled',
          scope: { kind: 'all' },
          resumeExisting: true,
        },
        { idempotencyKey: 'cli-in-process-1' },
      );
      expect(withKey.success === false ? withKey.problem?.code : undefined).not.toBe(
        'idempotency-key-required',
      );
    } finally {
      await host.dispose();
    }
  });

  it('refuses attached mutations without a caller-owned key and reuses one attempt', async () => {
    const sent: Array<{ type: string; key?: string }> = [];
    const handleCommand = createAttachedCliCommandHandler(async (command, options) => {
      sent.push({
        type: command.type,
        ...(options?.idempotencyKey === undefined ? {} : { key: options.idempotencyKey }),
      });
      return { type: 'response', command: command.type, success: true };
    });
    const command: HostCommand = {
      type: 'session/prompt',
      sessionId: 's1',
      input: { text: 'hi' },
      foreground: { kind: 'if-idle' },
    };
    const missing = await handleCommand(command);
    expect(missing).toMatchObject({
      success: false,
      problem: { code: 'idempotency-key-required' },
    });
    expect(sent).toHaveLength(0);
    const first = await handleCommand(command, { idempotencyKey: 'cli-gesture-1' });
    const retry = await handleCommand(command, { idempotencyKey: 'cli-gesture-1' });
    expect(first.success).toBe(true);
    expect(retry.success).toBe(true);
    expect(sent.map((item) => item.key)).toEqual(['cli-gesture-1', 'cli-gesture-1']);
  });
});
