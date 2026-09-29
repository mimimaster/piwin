import { createInterface } from 'node:readline/promises';
import type {
  ExtensionUiRequest,
  ExtensionUiResponse,
  HostCommand,
  HostPush,
} from '@piwin/contracts';

export type CliExtensionUiRequest = ExtensionUiRequest & { sessionId: string };

export type CliExtensionUiOptions = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  isInteractive?: boolean;
  ask?: (question: string) => Promise<string>;
};

type Ask = (question: string) => Promise<string>;
type TtyStream = { readonly isTTY?: boolean };

type SelectPromptInput = {
  title: string;
  options: string[];
};

export function formatSelectPrompt({ title, options }: SelectPromptInput): string {
  const numberedOptions = options.map((option, index) => `${index + 1}) ${option}`);
  return `${[title, ...numberedOptions].join('\n')}\nSelect an option: `;
}

export function parseSelection(value: string, optionCount: number): number | undefined {
  if (!Number.isSafeInteger(optionCount) || optionCount <= 0) {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!/^[1-9]\d*$/.test(trimmedValue)) {
    return undefined;
  }

  const selection = Number.parseInt(trimmedValue, 10) - 1;
  if (!Number.isSafeInteger(selection) || selection < 0 || selection >= optionCount) {
    return undefined;
  }
  return selection;
}

function hasTty(stream: NodeJS.ReadableStream | NodeJS.WritableStream): boolean {
  return (stream as TtyStream).isTTY === true;
}

function resolveInteractive(
  options: CliExtensionUiOptions | undefined,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): boolean {
  if (options?.isInteractive !== undefined) {
    return options.isInteractive;
  }
  return hasTty(input) && hasTty(output);
}

function createReadlineAsk(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Ask {
  return async (question: string): Promise<string> => {
    const readline = createInterface({ input, output });
    try {
      return await readline.question(question);
    } finally {
      readline.close();
    }
  };
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return false;
  }
  return error.name === 'AbortError';
}

function cancelledResponse(kind: CliExtensionUiRequest['kind']): ExtensionUiResponse {
  switch (kind) {
    case 'confirm':
      return { kind: 'confirm', confirmed: false };
    case 'select':
      return { kind: 'select', cancelled: true };
    case 'input':
      return { kind: 'input', cancelled: true };
  }
}

async function askOrCancel(
  ask: Ask,
  question: string,
  cancellation: ExtensionUiResponse,
): Promise<string | ExtensionUiResponse> {
  try {
    return await ask(question);
  } catch (error: unknown) {
    if (isAbortError(error)) {
      return cancellation;
    }
    throw error;
  }
}

function formatConfirmPrompt(request: CliExtensionUiRequest): string {
  const lines = [request.title];
  if (request.message !== undefined) {
    lines.push(request.message);
  }
  return `${lines.join('\n')}\nConfirm? [y/n] `;
}

function formatInputPrompt(request: CliExtensionUiRequest): string {
  const placeholder = request.placeholder === undefined ? '' : ` (${request.placeholder})`;
  return `${request.title}${placeholder}: `;
}

export function createCliExtensionUiRequestHandler(
  options?: CliExtensionUiOptions,
): (request: CliExtensionUiRequest) => Promise<ExtensionUiResponse> {
  const input = options?.input ?? process.stdin;
  const output = options?.output ?? process.stderr;
  const interactive = resolveInteractive(options, input, output);
  const ask = options?.ask ?? createReadlineAsk(input, output);

  return async (request: CliExtensionUiRequest): Promise<ExtensionUiResponse> => {
    if (!interactive) {
      return cancelledResponse(request.kind);
    }

    switch (request.kind) {
      case 'select': {
        const selectOptions = request.options;
        if (selectOptions === undefined || selectOptions.length === 0) {
          return cancelledResponse('select');
        }

        const answer = await askOrCancel(
          ask,
          formatSelectPrompt({ title: request.title, options: selectOptions }),
          cancelledResponse('select'),
        );
        if (typeof answer !== 'string') {
          return answer;
        }

        const selectedIndex = parseSelection(answer, selectOptions.length);
        if (selectedIndex === undefined) {
          return cancelledResponse('select');
        }
        const selectedValue = selectOptions[selectedIndex];
        if (selectedValue === undefined) {
          return cancelledResponse('select');
        }
        return { kind: 'select', value: selectedValue };
      }
      case 'confirm': {
        const answer = await askOrCancel(
          ask,
          formatConfirmPrompt(request),
          cancelledResponse('confirm'),
        );
        if (typeof answer !== 'string') {
          return answer;
        }

        const normalizedAnswer = answer.trim().toLowerCase();
        if (normalizedAnswer === 'y' || normalizedAnswer === 'yes') {
          return { kind: 'confirm', confirmed: true };
        }
        return { kind: 'confirm', confirmed: false };
      }
      case 'input': {
        const answer = await askOrCancel(
          ask,
          formatInputPrompt(request),
          cancelledResponse('input'),
        );
        if (typeof answer !== 'string') {
          return answer;
        }
        return { kind: 'input', value: answer };
      }
    }
  };
}

type ExtensionUiRequestPush = Extract<HostPush, { type: 'extension/ui_request' }>;
type ExtensionUiResolveCommand = Extract<HostCommand, { type: 'extension/ui_resolve' }>;

export function toExtensionUiResolveCommand(
  requestId: string,
  response: ExtensionUiResponse,
): ExtensionUiResolveCommand {
  if (response.kind === 'confirm') {
    return { type: 'extension/ui_resolve', requestId, confirmed: response.confirmed };
  }
  if (response.cancelled === true || response.value === undefined) {
    return { type: 'extension/ui_resolve', requestId, cancelled: true };
  }
  return { type: 'extension/ui_resolve', requestId, value: response.value };
}

/**
 * Answer Host `extension/ui_request` pushes on the TTY and send the answer back
 * as `extension/ui_resolve` (ADR 0023). Without this, a CLI-driven run blocks
 * on the Host's pending Extension UI promise until the prompt timeout.
 *
 * Requests are answered one at a time so concurrent prompts never interleave
 * on stderr.
 */
export function createCliExtensionUiPushResponder(
  resolve: (command: ExtensionUiResolveCommand) => Promise<unknown>,
  options?: CliExtensionUiOptions,
): (push: ExtensionUiRequestPush) => Promise<void> {
  const handle = createCliExtensionUiRequestHandler(options);
  let queue: Promise<void> = Promise.resolve();
  return (push) => {
    const answered = queue.then(async () => {
      const response = await handle(push);
      await resolve(toExtensionUiResolveCommand(push.requestId, response));
    });
    queue = answered.catch(() => undefined);
    return answered;
  };
}

type ExtensionSurfacePush = Extract<
  HostPush,
  { type: 'extension/ui_surface' | 'extension/ui_notice' }
>;

/**
 * CLI projection of extension surface pushes (ADR 0080): notices print once,
 * statuses and text widgets print only when their text changes. Returns
 * whether the push was an extension surface push.
 */
export function createCliExtensionSurfacePrinter(
  write: (line: string) => void = (line) => process.stderr.write(line),
): (push: HostPush) => boolean {
  const printed = new Map<string, string>();
  return (push) => {
    if (!isExtensionSurfacePush(push)) return false;
    if (push.type === 'extension/ui_notice') {
      const tag = push.level === 'info' ? 'extension' : `extension ${push.level}`;
      write(`[${tag}] ${push.message}\n`);
      return true;
    }
    const { sessionId, statuses, widgets } = push.snapshot;
    const current = new Map<string, string>();
    for (const status of statuses) current.set(`status:${status.key}`, status.text);
    for (const widget of widgets) current.set(`widget:${widget.key}`, widget.lines.join('\n'));
    for (const [key, text] of current) {
      const printedKey = `${sessionId}\u0000${key}`;
      if (printed.get(printedKey) === text) continue;
      printed.set(printedKey, text);
      const label = key.slice(key.indexOf(':') + 1);
      write(key.startsWith('status:') ? `[${label}] ${text}\n` : `[${label}]\n${text}\n`);
    }
    for (const printedKey of [...printed.keys()]) {
      const [owner, key] = printedKey.split('\u0000');
      if (owner === sessionId && key !== undefined && !current.has(key)) printed.delete(printedKey);
    }
    return true;
  };
}

function isExtensionSurfacePush(push: HostPush): push is ExtensionSurfacePush {
  return push.type === 'extension/ui_surface' || push.type === 'extension/ui_notice';
}
