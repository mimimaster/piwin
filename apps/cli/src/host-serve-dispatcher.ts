/**
 * ADR 0015 host serve dispatcher: control lane bypasses serial work.
 * ADR 0027: transport-agnostic — takes a `send` function, not a JsonlWriter.
 */
import type { HostCommand, HostCommandRequest, HostResponse, HostServerMessage } from '@piwin/contracts';
import { formatHostError } from '@piwin/contracts';
import type { HostRuntime } from '@piwin/host-runtime';
import { classifyHostServeCommand } from './host-serve-command-lane.js';

/** Frame sender the dispatcher uses to write responses. Transport-agnostic. */
export type HostServeSend = (message: HostServerMessage) => Promise<void>;

export type HostServeDispatcherOptions = {
  runtime: HostRuntime;
  send: HostServeSend;
  /** Timeout for non-prompt request handling. Prompt is quick-ack after ADR 0015. */
  commandTimeoutMs?: number;
  admit?: (
    request: HostCommandRequest,
    execute: () => Promise<HostResponse>,
  ) => Promise<HostResponse>;
};

export type HostServeDispatcher = {
  dispatch: (command: HostCommand | HostCommandRequest) => void;
  /** Stop accepting commands and await every queued or active command. */
  drain: () => Promise<void>;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;

function commandTimeoutMs(command: HostCommand, defaultTimeoutMs: number): number | undefined {
  switch (command.type) {
    case 'session/compact':
    case 'session/compact-export':
      // These commands await a model completion. The control lane remains
      // available for session/compact-abort, so a wall-clock dispatcher
      // deadline would only detach the response from work that keeps running.
      return undefined;
    case 'extensions/apply':
      // `when: 'after-current-run'` waits for the live run to drain before the
      // runtime replacement commits. The Host quick-ACKs that state as a
      // durable deployment and reports completion via
      // `extension/deployment-updated`; a dispatcher deadline would report a
      // false failure while the serialized apply keeps running in the
      // background. The `when: 'now'` path is the remaining long tail, so keep
      // the whole command unbounded like session/compact.
      return undefined;
    default:
      return defaultTimeoutMs;
  }
}

export function createHostServeDispatcher(
  options: HostServeDispatcherOptions,
): HostServeDispatcher {
  const timeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  let serializedChain: Promise<void> = Promise.resolve();
  const inFlightCommands = new Set<Promise<void>>();
  let acceptingCommands = true;
  let drainPromise: Promise<void> | undefined;

  function dispatch(command: HostCommand | HostCommandRequest): void {
    if (!acceptingCommands) {
      return;
    }
    const request = toHostCommandRequest(command);
    const lane = classifyHostServeCommand(request.command);
    const commandDeadlineMs = commandTimeoutMs(request.command, timeoutMs);
    if (lane === 'control' || lane === 'concurrent') {
      void trackCommand(
        runCommand(options.runtime, options.send, request, commandDeadlineMs, options.admit),
      );
      return;
    }
    serializedChain = trackCommand(
      serializedChain.then(() =>
        runCommand(options.runtime, options.send, request, commandDeadlineMs, options.admit),
      ),
    );
  }

  async function drain(): Promise<void> {
    acceptingCommands = false;
    if (drainPromise === undefined) {
      drainPromise = waitForInFlightCommands();
    }
    await drainPromise;
  }

  function trackCommand(commandPromise: Promise<void>): Promise<void> {
    const trackedPromise = commandPromise.catch(() => undefined);
    inFlightCommands.add(trackedPromise);
    void trackedPromise.then(() => {
      inFlightCommands.delete(trackedPromise);
    });
    return trackedPromise;
  }

  async function waitForInFlightCommands(): Promise<void> {
    while (inFlightCommands.size > 0) {
      await Promise.all([...inFlightCommands]);
    }
  }

  return { dispatch, drain };
}

async function runCommand(
  runtime: HostRuntime,
  send: HostServeSend,
  request: HostCommandRequest,
  timeoutMs: number | undefined,
  admit:
    | ((request: HostCommandRequest, execute: () => Promise<HostResponse>) => Promise<HostResponse>)
    | undefined,
): Promise<void> {
  const command = request.command;
  const commandId = typeof command.id === 'string' ? command.id : undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const handle = (): Promise<HostResponse> =>
      request.idempotencyKey
        ? runtime.handleCommand(command, { idempotencyKey: request.idempotencyKey })
        : runtime.handleCommand(command);
    const execute = (): Promise<HostResponse> =>
      timeoutMs === undefined
        ? handle()
        : Promise.race([
            handle(),
            new Promise<never>((_resolve, reject) => {
              timeoutId = setTimeout(() => {
                reject(new Error(`command timed out after ${timeoutMs}ms`));
              }, timeoutMs);
              timeoutId.unref();
            }),
          ]);
    const response: HostResponse = admit === undefined ? await execute() : await admit(request, execute);
    await send(response);
  } catch (error) {
    const failure: HostServerMessage = {
      type: 'response',
      command: command.type,
      success: false,
      error: formatHostError(command.type, error),
      ...(commandId ? { id: commandId } : {}),
    };
    await send(failure);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function toHostCommandRequest(value: HostCommand | HostCommandRequest): HostCommandRequest {
  if (isHostCommandRequest(value)) {
    return value;
  }
  return { command: value };
}

function isHostCommandRequest(value: HostCommand | HostCommandRequest): value is HostCommandRequest {
  return (
    'command' in value &&
    typeof value.command === 'object' &&
    value.command !== null &&
    typeof value.command.type === 'string'
  );
}
