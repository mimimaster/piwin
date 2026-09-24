import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createCliExtensionUiPushResponder,
  createCliExtensionUiRequestHandler,
  toExtensionUiResolveCommand,
  formatSelectPrompt,
  parseSelection,
  type CliExtensionUiRequest,
} from './extension-ui-cli.js';

type TtyReadable = NodeJS.ReadableStream & { isTTY: boolean };
type TtyWritable = NodeJS.WritableStream & { isTTY: boolean };

function createTtyInput(line: string): TtyReadable {
  const input = Readable.from([`${line}\n`]) as unknown as TtyReadable;
  input.isTTY = true;
  return input;
}

function createTtyOutput(): { output: TtyWritable; read: () => string } {
  let contents = '';
  const output = new Writable({
    write(chunk, _encoding, callback) {
      contents += chunk.toString();
      callback();
    },
  }) as unknown as TtyWritable;
  output.isTTY = true;
  return { output, read: () => contents };
}

function createRequest(overrides: Partial<CliExtensionUiRequest>): CliExtensionUiRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    kind: 'input',
    title: 'Question',
    ...overrides,
  };
}

describe('formatSelectPrompt', () => {
  it('formats a deterministic numbered prompt', () => {
    const prompt = formatSelectPrompt({ title: 'Choose mode', options: ['SDK', 'RPC'] });

    expect(prompt).toContain('Choose mode');
    expect(prompt).toContain('1) SDK');
    expect(prompt).toContain('2) RPC');
  });
});

describe('parseSelection', () => {
  it('converts a valid one-based selection to a zero-based index', () => {
    expect(parseSelection('2', 2)).toBe(1);
    expect(parseSelection(' 1 ', 2)).toBe(0);
  });

  it('rejects empty, malformed, and out-of-range selections', () => {
    expect(parseSelection('', 2)).toBeUndefined();
    expect(parseSelection('nope', 2)).toBeUndefined();
    expect(parseSelection('3', 2)).toBeUndefined();
    expect(parseSelection('0', 2)).toBeUndefined();
  });
});

describe('createCliExtensionUiRequestHandler', () => {
  it('returns the selected option from an injected asker', async () => {
    const questions: string[] = [];
    const handler = createCliExtensionUiRequestHandler({
      isInteractive: true,
      ask: async (question) => {
        questions.push(question);
        return '2';
      },
    });

    await expect(
      handler(
        createRequest({
          kind: 'select',
          title: 'Choose mode',
          options: ['SDK', 'RPC'],
        }),
      ),
    ).resolves.toEqual({ kind: 'select', value: 'RPC' });
    expect(questions[0]).toContain('1) SDK');
  });

  it('cancels invalid and empty selections without retrying', async () => {
    let askCount = 0;
    const handler = createCliExtensionUiRequestHandler({
      isInteractive: true,
      ask: async () => {
        askCount += 1;
        return '';
      },
    });

    await expect(
      handler(createRequest({ kind: 'select', options: ['SDK', 'RPC'] })),
    ).resolves.toEqual({ kind: 'select', cancelled: true });
    expect(askCount).toBe(1);
  });

  it('maps yes and no confirmation answers', async () => {
    const yesHandler = createCliExtensionUiRequestHandler({
      isInteractive: true,
      ask: async () => 'YES',
    });
    const noHandler = createCliExtensionUiRequestHandler({
      isInteractive: true,
      ask: async () => 'n',
    });

    await expect(yesHandler(createRequest({ kind: 'confirm' }))).resolves.toEqual({
      kind: 'confirm',
      confirmed: true,
    });
    await expect(noHandler(createRequest({ kind: 'confirm' }))).resolves.toEqual({
      kind: 'confirm',
      confirmed: false,
    });
  });

  it('returns input values and cancels an aborted input', async () => {
    const inputHandler = createCliExtensionUiRequestHandler({
      isInteractive: true,
      ask: async () => 'typed response',
    });
    const abortHandler = createCliExtensionUiRequestHandler({
      isInteractive: true,
      ask: async () => {
        const error = new Error('user cancelled');
        error.name = 'AbortError';
        throw error;
      },
    });

    await expect(inputHandler(createRequest({ kind: 'input' }))).resolves.toEqual({
      kind: 'input',
      value: 'typed response',
    });
    await expect(abortHandler(createRequest({ kind: 'input' }))).resolves.toEqual({
      kind: 'input',
      cancelled: true,
    });
  });

  it('cancels without invoking the asker when streams are non-TTY', async () => {
    const input = Readable.from([]) as unknown as NodeJS.ReadableStream & { isTTY: boolean };
    input.isTTY = false;
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }) as unknown as NodeJS.WritableStream & { isTTY: boolean };
    output.isTTY = false;
    let askCount = 0;
    const handler = createCliExtensionUiRequestHandler({
      input,
      output,
      ask: async () => {
        askCount += 1;
        return '1';
      },
    });

    await expect(
      handler(createRequest({ kind: 'select', options: ['only option'] })),
    ).resolves.toEqual({ kind: 'select', cancelled: true });
    expect(askCount).toBe(0);
  });

  it('writes default readline prompts to the injected output stream', async () => {
    const { output, read } = createTtyOutput();
    const handler = createCliExtensionUiRequestHandler({
      input: createTtyInput('1'),
      output,
    });

    await expect(
      handler(createRequest({ kind: 'select', title: 'Choose', options: ['first'] })),
    ).resolves.toEqual({ kind: 'select', value: 'first' });
    expect(read()).toContain('Choose');
    expect(read()).toContain('1) first');
  });

  it('rethrows unexpected asker errors', async () => {
    const error = new Error('unexpected failure');
    const handler = createCliExtensionUiRequestHandler({
      isInteractive: true,
      ask: async () => {
        throw error;
      },
    });

    await expect(handler(createRequest({ kind: 'input' }))).rejects.toBe(error);
  });
});

describe('toExtensionUiResolveCommand', () => {
  it('maps each response kind onto extension/ui_resolve', () => {
    expect(toExtensionUiResolveCommand('r1', { kind: 'confirm', confirmed: true })).toEqual({
      type: 'extension/ui_resolve',
      requestId: 'r1',
      confirmed: true,
    });
    expect(toExtensionUiResolveCommand('r2', { kind: 'select', value: 'Beta' })).toEqual({
      type: 'extension/ui_resolve',
      requestId: 'r2',
      value: 'Beta',
    });
    expect(toExtensionUiResolveCommand('r3', { kind: 'input', cancelled: true })).toEqual({
      type: 'extension/ui_resolve',
      requestId: 'r3',
      cancelled: true,
    });
  });
});

describe('createCliExtensionUiPushResponder', () => {
  it('answers pushes in order and resolves them on the Host', async () => {
    const resolved: unknown[] = [];
    const answers = ['2', 'typed'];
    const respond = createCliExtensionUiPushResponder(
      async (command) => {
        resolved.push(command);
      },
      { isInteractive: true, ask: async () => answers.shift() ?? '' },
    );

    await Promise.all([
      respond({
        type: 'extension/ui_request',
        sessionId: 'session-1',
        requestId: 'q1',
        kind: 'select',
        title: 'Pick one',
        options: ['Alpha', 'Beta'],
      }),
      respond({
        type: 'extension/ui_request',
        sessionId: 'session-1',
        requestId: 'q2',
        kind: 'input',
        title: 'Other',
      }),
    ]);

    expect(resolved).toEqual([
      { type: 'extension/ui_resolve', requestId: 'q1', value: 'Beta' },
      { type: 'extension/ui_resolve', requestId: 'q2', value: 'typed' },
    ]);
  });

  it('cancels instead of blocking when the CLI is not interactive', async () => {
    const resolved: unknown[] = [];
    const respond = createCliExtensionUiPushResponder(
      async (command) => {
        resolved.push(command);
      },
      { isInteractive: false },
    );

    await respond({
      type: 'extension/ui_request',
      sessionId: 'session-1',
      requestId: 'q1',
      kind: 'select',
      title: 'Pick one',
      options: ['Alpha'],
    });

    expect(resolved).toEqual([
      { type: 'extension/ui_resolve', requestId: 'q1', cancelled: true },
    ]);
  });
});
