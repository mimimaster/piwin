import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostCommand, HostPush, HostResponse, WalkthroughArtifact } from '@piwin/contracts';
import {
  formatWalkthroughListRow,
  formatWalkthroughListTable,
  resolveExportOutputPath,
  runWalkthroughExport,
  runWalkthroughGenerate,
  runWalkthroughList,
  type WalkthroughHostClient,
} from './walkthrough-command.js';

/** Narrow a HostCommand to the walkthrough/generate variant. */
type GenerateCommand = Extract<HostCommand, { type: 'walkthrough/generate' }>;
/** Narrow a HostCommand to the walkthrough/list variant. */
type ListCommand = Extract<HostCommand, { type: 'walkthrough/list' }>;

/** Cast to GenerateCommand after asserting the command type at the call site. */
function asGenerate(command: HostCommand): GenerateCommand {
  return command as GenerateCommand;
}

/** Cast to ListCommand after asserting the command type at the call site. */
function asList(command: HostCommand): ListCommand {
  return command as ListCommand;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeReadyArtifact(overrides: Partial<WalkthroughArtifact> = {}): WalkthroughArtifact {
  return {
    version: 1,
    id: 'art-1',
    sessionId: 'sess-1',
    messageId: 'msg-1',
    mode: 'default',
    sourceHash: 'abc',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    status: 'ready',
    markdown: '# Walkthrough\n\n## Summary\nDid the thing.',
    generatedAt: '2026-08-01T00:00:05.000Z',
    model: { protocol: 'openai-compatible', providerId: 'prov', modelId: 'model-a' },
    ...overrides,
  } as WalkthroughArtifact;
}

function makeGeneratingArtifact(overrides: Partial<WalkthroughArtifact> = {}): WalkthroughArtifact {
  return {
    version: 1,
    id: 'art-2',
    sessionId: 'sess-1',
    messageId: 'msg-2',
    mode: 'default',
    sourceHash: 'abc',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    status: 'generating',
    generationId: 'gen-2',
    ...overrides,
  } as WalkthroughArtifact;
}

function makeErrorArtifact(overrides: Partial<WalkthroughArtifact> = {}): WalkthroughArtifact {
  return {
    version: 1,
    id: 'art-3',
    sessionId: 'sess-1',
    messageId: 'msg-3',
    mode: 'default',
    sourceHash: 'abc',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    status: 'error',
    error: { code: 'model-unavailable', message: 'No model available.' },
    generatedAt: '2026-08-01T00:00:05.000Z',
    ...overrides,
  } as WalkthroughArtifact;
}

/**
 * Build a mock host client with scripted command responses and optional push
 * emission. The `onPush` handler registry lets tests emit `walkthrough/updated`
 * pushes at controlled times.
 */
function createMockClient(options: {
  handleCommand?: (command: HostCommand) => Promise<HostResponse> | HostResponse;
}): WalkthroughHostClient {
  const pushHandlers = new Set<(message: HostPush) => void>();
  const handleCommand =
    options.handleCommand ??
    (async (): Promise<HostResponse> => ({
      type: 'response',
      command: 'unknown',
      success: true,
      data: {},
    }));
  return {
    handleCommand: vi.fn(async (command: HostCommand) => handleCommand(command)),
    onPush: vi.fn((handler: (message: HostPush) => void) => {
      pushHandlers.add(handler);
      return () => {
        pushHandlers.delete(handler);
      };
    }),
    dispose: vi.fn(async () => undefined),
  };
}

/** Emit a push to all registered handlers on a mock client. */
function emitPush(client: WalkthroughHostClient, message: HostPush): void {
  const onPush = client.onPush as unknown as {
    mock?: { calls: Array<[handler: (message: HostPush) => void]> };
  };
  const calls = onPush.mock?.calls ?? [];
  for (const [handler] of calls) {
    handler(message);
  }
}

function captureLog(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

/* ------------------------------------------------------------------ */
/* formatWalkthroughListRow / Table                                    */
/* ------------------------------------------------------------------ */

describe('formatWalkthroughListRow', () => {
  it('formats a ready artifact with messageId, status, mode, generatedAt', () => {
    const artifact = makeReadyArtifact();
    expect(formatWalkthroughListRow(artifact)).toBe(
      'msg-1\tready\tdefault\t2026-08-01T00:00:05.000Z',
    );
  });

  it('formats a generating artifact with - for generatedAt', () => {
    const artifact = makeGeneratingArtifact();
    expect(formatWalkthroughListRow(artifact)).toBe('msg-2\tgenerating\tdefault\t-');
  });

  it('formats an error artifact with its generatedAt', () => {
    const artifact = makeErrorArtifact();
    expect(formatWalkthroughListRow(artifact)).toBe(
      'msg-3\terror\tdefault\t2026-08-01T00:00:05.000Z',
    );
  });
});

describe('formatWalkthroughListTable', () => {
  it('returns a placeholder for empty artifacts', () => {
    expect(formatWalkthroughListTable([])).toBe('(no walkthroughs)');
  });

  it('renders a header followed by rows', () => {
    const artifacts = [makeReadyArtifact(), makeGeneratingArtifact()];
    const table = formatWalkthroughListTable(artifacts);
    const lines = table.split('\n');
    expect(lines[0]).toBe('messageId\tstatus\tmode\tgeneratedAt');
    expect(lines[1]).toBe('msg-1\tready\tdefault\t2026-08-01T00:00:05.000Z');
    expect(lines[2]).toBe('msg-2\tgenerating\tdefault\t-');
  });
});

/* ------------------------------------------------------------------ */
/* resolveExportOutputPath                                              */
/* ------------------------------------------------------------------ */

describe('resolveExportOutputPath', () => {
  it('resolves a relative path under cwd', () => {
    const cwd = '/tmp/proj';
    const resolved = resolveExportOutputPath('out/walkthrough.md', cwd, () => false);
    expect(resolved).toBe(join(cwd, 'out', 'walkthrough.md'));
  });

  it('resolves an absolute path under cwd', () => {
    const cwd = '/tmp/proj';
    const resolved = resolveExportOutputPath('/tmp/proj/out.md', cwd, () => false);
    expect(resolved).toBe('/tmp/proj/out.md');
  });

  it('rejects a path that escapes cwd via traversal', () => {
    const cwd = '/tmp/proj';
    expect(() => resolveExportOutputPath('../../etc/passwd', cwd, () => false)).toThrow(
      /escapes the working directory/,
    );
  });

  it('rejects an absolute path outside cwd', () => {
    const cwd = '/tmp/proj';
    expect(() => resolveExportOutputPath('/etc/passwd', cwd, () => false)).toThrow(
      /escapes the working directory/,
    );
  });

  it('rejects a path that points to cwd itself', () => {
    const cwd = '/tmp/proj';
    expect(() => resolveExportOutputPath('.', cwd, () => false)).toThrow(/working directory/);
  });

  it('rejects an existing file to prevent overwrite', () => {
    const cwd = '/tmp/proj';
    expect(() => resolveExportOutputPath('out.md', cwd, () => true)).toThrow(/already exists/);
  });
});

/* ------------------------------------------------------------------ */
/* runWalkthroughList                                                  */
/* ------------------------------------------------------------------ */

describe('runWalkthroughList', () => {
  it('prints a table of artifacts', async () => {
    const artifacts = [makeReadyArtifact(), makeGeneratingArtifact()];
    const client = createMockClient({
      handleCommand: async (command) => {
        if (command.type === 'walkthrough/list') {
          return {
            type: 'response',
            command: 'walkthrough/list',
            success: true,
            data: { sessionId: command.sessionId, artifacts },
          };
        }
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      },
    });
    const { lines, log } = captureLog();
    await runWalkthroughList(client, 'sess-1', log);
    const output = lines.join('\n');
    const expectedLines = output.split('\n');
    expect(expectedLines[0]).toBe('messageId\tstatus\tmode\tgeneratedAt');
    expect(expectedLines[1]).toBe('msg-1\tready\tdefault\t2026-08-01T00:00:05.000Z');
    expect(expectedLines[2]).toBe('msg-2\tgenerating\tdefault\t-');
  });

  it('prints placeholder when no artifacts exist', async () => {
    const client = createMockClient({
      handleCommand: async () => ({
        type: 'response',
        command: 'walkthrough/list',
        success: true,
        data: { sessionId: 'sess-1', artifacts: [] },
      }),
    });
    const { lines, log } = captureLog();
    await runWalkthroughList(client, 'sess-1', log);
    expect(lines).toEqual(['(no walkthroughs)']);
  });

  it('throws on host error', async () => {
    const client = createMockClient({
      handleCommand: async () => ({
        type: 'response',
        command: 'walkthrough/list',
        success: false,
        error: 'session not found',
      }),
    });
    const { log } = captureLog();
    await expect(runWalkthroughList(client, 'sess-1', log)).rejects.toThrow('session not found');
  });
});

/* ------------------------------------------------------------------ */
/* runWalkthroughGenerate                                              */
/* ------------------------------------------------------------------ */

describe('runWalkthroughGenerate', () => {
  it('prints markdown when host returns a ready artifact directly (cached)', async () => {
    const ready = makeReadyArtifact();
    const client = createMockClient({
      handleCommand: async (command) => {
        if (command.type === 'walkthrough/generate') {
          return {
            type: 'response',
            command: 'walkthrough/generate',
            success: true,
            data: {
              sessionId: command.sessionId,
              messageId: command.messageId,
              status: 'ready',
              artifact: ready,
            },
          };
        }
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      },
    });
    const { lines, log } = captureLog();
    const result = await runWalkthroughGenerate(client, 'sess-1', 'msg-1', log);
    expect(result).toBe(ready);
    expect(lines[0]).toBe('# Walkthrough\n\n## Summary\nDid the thing.');
  });

  it('waits for walkthrough/updated(ready) push and prints markdown', async () => {
    const ready = makeReadyArtifact();
    const client = createMockClient({
      handleCommand: async (command) => {
        if (command.type === 'walkthrough/generate') {
          return {
            type: 'response',
            command: 'walkthrough/generate',
            success: true,
            data: {
              sessionId: command.sessionId,
              messageId: command.messageId,
              generationId: 'gen-1',
              status: 'generating',
            },
          };
        }
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      },
    });
    const { lines, log } = captureLog();

    // Emit the ready push after the command is accepted.
    const generatePromise = runWalkthroughGenerate(client, 'sess-1', 'msg-1', log, {
      timeoutMs: 1000,
    });
    // Let the subscribe handler register.
    await new Promise((r) => setTimeout(r, 10));
    emitPush(client, { type: 'walkthrough/updated', sessionId: 'sess-1', artifact: ready });

    const result = await generatePromise;
    expect(result).toBe(ready);
    expect(lines[0]).toBe('# Walkthrough\n\n## Summary\nDid the thing.');
  });

  it('waits for walkthrough/updated(error) push and prints error message', async () => {
    const errorArtifact = makeErrorArtifact();
    const client = createMockClient({
      handleCommand: async (command) => {
        const gen = asGenerate(command);
        return {
          type: 'response',
          command: 'walkthrough/generate',
          success: true,
          data: {
            sessionId: gen.sessionId,
            messageId: gen.messageId,
            generationId: 'gen-3',
            status: 'generating',
          },
        };
      },
    });
    const { lines, log } = captureLog();

    const generatePromise = runWalkthroughGenerate(client, 'sess-1', 'msg-3', log, {
      timeoutMs: 1000,
    });
    await new Promise((r) => setTimeout(r, 10));
    emitPush(client, { type: 'walkthrough/updated', sessionId: 'sess-1', artifact: errorArtifact });

    const result = await generatePromise;
    expect(result).toBe(errorArtifact);
    expect(lines[0]).toBe('[walkthrough error] model-unavailable: No model available.');
  });

  it('ignores pushes for other sessions or messages', async () => {
    const ready = makeReadyArtifact({ messageId: 'msg-target' });
    const client = createMockClient({
      handleCommand: async (command) => {
        const gen = asGenerate(command);
        return {
          type: 'response',
          command: 'walkthrough/generate',
          success: true,
          data: {
            sessionId: gen.sessionId,
            messageId: gen.messageId,
            generationId: 'gen-x',
            status: 'generating',
          },
        };
      },
    });
    const { lines, log } = captureLog();

    const generatePromise = runWalkthroughGenerate(client, 'sess-1', 'msg-target', log, {
      timeoutMs: 1000,
    });
    await new Promise((r) => setTimeout(r, 10));
    // Wrong session
    emitPush(client, {
      type: 'walkthrough/updated',
      sessionId: 'sess-other',
      artifact: makeReadyArtifact({ sessionId: 'sess-other', messageId: 'msg-target' }),
    });
    // Wrong message
    emitPush(client, {
      type: 'walkthrough/updated',
      sessionId: 'sess-1',
      artifact: makeReadyArtifact({ messageId: 'msg-other' }),
    });
    // Generating status (should be ignored)
    emitPush(client, {
      type: 'walkthrough/updated',
      sessionId: 'sess-1',
      artifact: makeGeneratingArtifact({ messageId: 'msg-target' }),
    });
    // Correct push
    emitPush(client, { type: 'walkthrough/updated', sessionId: 'sess-1', artifact: ready });

    const result = await generatePromise;
    expect(result).toBe(ready);
    expect(lines[0]).toBe('# Walkthrough\n\n## Summary\nDid the thing.');
  });

  it('throws on host command error', async () => {
    const client = createMockClient({
      handleCommand: async () => ({
        type: 'response',
        command: 'walkthrough/generate',
        success: false,
        error: 'disabled',
      }),
    });
    const { log } = captureLog();
    await expect(
      runWalkthroughGenerate(client, 'sess-1', 'msg-1', log, { timeoutMs: 500 }),
    ).rejects.toThrow('disabled');
  });

  it('does not produce an unhandled rejection when the host command fails', async () => {
    // Regression: previously the wait promise's timeout timer kept running after
    // the command threw, eventually rejecting with "Timed out waiting for
    // walkthrough generation" with no awaiter -> unhandled promise rejection.
    const client = createMockClient({
      handleCommand: async () => ({
        type: 'response',
        command: 'walkthrough/generate',
        success: false,
        error: 'disabled',
      }),
    });
    const { log } = captureLog();

    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      await expect(
        runWalkthroughGenerate(client, 'sess-1', 'msg-1', log, { timeoutMs: 20 }),
      ).rejects.toThrow('disabled');
      // Wait well past the (now-cancelled) timeout so any orphaned timer would
      // have fired and surfaced as an unhandled rejection.
      await new Promise((r) => setTimeout(r, 60));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('does not produce an unhandled rejection when a cached ready artifact is returned', async () => {
    // Same regression class: the cached-ready early return must also cancel the
    // wait so its timeout timer does not orphan into an unhandled rejection.
    const ready = makeReadyArtifact();
    const client = createMockClient({
      handleCommand: async (command) => {
        if (command.type === 'walkthrough/generate') {
          return {
            type: 'response',
            command: 'walkthrough/generate',
            success: true,
            data: {
              sessionId: command.sessionId,
              messageId: command.messageId,
              status: 'ready',
              artifact: ready,
            },
          };
        }
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      },
    });
    const { log } = captureLog();

    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const result = await runWalkthroughGenerate(client, 'sess-1', 'msg-1', log, {
        timeoutMs: 20,
      });
      expect(result).toBe(ready);
      await new Promise((r) => setTimeout(r, 60));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('rejects on timeout when no push arrives', async () => {
    const client = createMockClient({
      handleCommand: async (command) => {
        const gen = asGenerate(command);
        return {
          type: 'response',
          command: 'walkthrough/generate',
          success: true,
          data: {
            sessionId: gen.sessionId,
            messageId: gen.messageId,
            generationId: 'gen-t',
            status: 'generating',
          },
        };
      },
    });
    const { log } = captureLog();
    await expect(
      runWalkthroughGenerate(client, 'sess-1', 'msg-1', log, { timeoutMs: 50 }),
    ).rejects.toThrow(/Timed out/);
  });
});

/* ------------------------------------------------------------------ */
/* runWalkthroughExport                                                */
/* ------------------------------------------------------------------ */

describe('runWalkthroughExport', () => {
  it('writes markdown to stdout when no --output is provided', async () => {
    const ready = makeReadyArtifact();
    const client = createMockClient({
      handleCommand: async (command) => {
        if (command.type === 'walkthrough/list') {
          return {
            type: 'response',
            command: 'walkthrough/list',
            success: true,
            data: { sessionId: command.sessionId, artifacts: [ready] },
          };
        }
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      },
    });
    const { lines, log } = captureLog();
    await runWalkthroughExport(client, 'sess-1', 'msg-1', log, {});
    expect(lines).toEqual(['# Walkthrough\n\n## Summary\nDid the thing.']);
  });

  it('writes markdown to a file when --output is provided', async () => {
    const ready = makeReadyArtifact();
    const client = createMockClient({
      handleCommand: async (command) => {
        const list = asList(command);
        return {
          type: 'response',
          command: 'walkthrough/list',
          success: true,
          data: { sessionId: list.sessionId, artifacts: [ready] },
        };
      },
    });
    const dir = await mkdtemp(join(tmpdir(), 'piwin-walkthrough-export-'));
    const outPath = join(dir, 'out', 'walkthrough.md');
    const { lines, log } = captureLog();
    await runWalkthroughExport(client, 'sess-1', 'msg-1', log, {
      outputPath: outPath,
      cwd: dir,
      exists: () => false,
    });
    const written = await import('node:fs/promises').then((fs) => fs.readFile(outPath, 'utf8'));
    expect(written).toBe('# Walkthrough\n\n## Summary\nDid the thing.');
    expect(lines[0]).toMatch(/exported \d+ bytes to/);
  });

  it('errors when the artifact is not ready', async () => {
    const generating = makeGeneratingArtifact();
    const client = createMockClient({
      handleCommand: async (command) => {
        const list = asList(command);
        return {
          type: 'response',
          command: 'walkthrough/list',
          success: true,
          data: { sessionId: list.sessionId, artifacts: [generating] },
        };
      },
    });
    const { log } = captureLog();
    await expect(runWalkthroughExport(client, 'sess-1', 'msg-2', log, {})).rejects.toThrow(
      /is generating, not ready/,
    );
  });

  it('errors when no artifact exists for the message', async () => {
    const client = createMockClient({
      handleCommand: async (command) => {
        const list = asList(command);
        return {
          type: 'response',
          command: 'walkthrough/list',
          success: true,
          data: { sessionId: list.sessionId, artifacts: [] },
        };
      },
    });
    const { log } = captureLog();
    await expect(runWalkthroughExport(client, 'sess-1', 'msg-missing', log, {})).rejects.toThrow(
      /No walkthrough artifact found/,
    );
  });

  it('errors when host returns failure', async () => {
    const client = createMockClient({
      handleCommand: async () => ({
        type: 'response',
        command: 'walkthrough/list',
        success: false,
        error: 'session not found',
      }),
    });
    const { log } = captureLog();
    await expect(runWalkthroughExport(client, 'sess-1', 'msg-1', log, {})).rejects.toThrow(
      'session not found',
    );
  });

  it('refuses to overwrite an existing file', async () => {
    const ready = makeReadyArtifact();
    const client = createMockClient({
      handleCommand: async (command) => {
        const list = asList(command);
        return {
          type: 'response',
          command: 'walkthrough/list',
          success: true,
          data: { sessionId: list.sessionId, artifacts: [ready] },
        };
      },
    });
    const dir = await mkdtemp(join(tmpdir(), 'piwin-walkthrough-export-'));
    const existingPath = join(dir, 'existing.md');
    await writeFile(existingPath, 'old content', 'utf8');
    const { log } = captureLog();
    await expect(
      runWalkthroughExport(client, 'sess-1', 'msg-1', log, {
        outputPath: existingPath,
        cwd: dir,
        exists: () => true,
      }),
    ).rejects.toThrow(/already exists/);
  });
});
