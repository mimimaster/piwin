/**
 * ADR 0015 host serve dispatcher: control lane bypasses serial work.
 * ADR 0027: transport-agnostic — takes a `send` function, not a JsonlWriter.
 */
import type { HostCommand, HostCommandRequest, HostResponse, HostServerMessage } from '@piwin/contracts';
import { formatHostError } from '@piwin/contracts';
import type { HostRuntime } from '@piwin/host-runtime';
import { classifyHostServeCommand, type HostServeCommandLane } from './host-serve-command-lane.js';
import {
  createInFlightCommandTracker,
  type InFlightCommandSnapshot,
  type InFlightCommandTracker,
} from './host-serve-inflight-commands.js';

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
  /** Host log sink for slow / long-running command lines. Defaults to stderr. */
  log?: (line: string) => void;
};

export type HostServeDispatcher = {
  dispatch: (command: HostCommand | HostCommandRequest) => void;
  /** Stop accepting commands and await every queued or active command. */
  drain: () => Promise<void>;
  /** Handlers still running, including ones whose client already got a timeout. */
  inFlightCommands: () => InFlightCommandSnapshot[];
  /** Log handlers that crossed their next long-running report age. */
  reportLongRunningCommands: () => number;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;
/** Commands slower than this (queue wait + run) leave a line in the Host log. */
export const HOST_SERVE_SLOW_COMMAND_MS = 2_000;

function commandTimeoutMs(command: HostCommand, defaultTimeoutMs: number): number | undefined {
  switch (command.type) {
    case 'session/compact':
    case 'session/compact-export':
    case 'session/handoff':
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
  const log = options.log ?? ((line: string): void => console.error(line));
  const handlers = createInFlightCommandTracker({ log });
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
    const queuedAt = Date.now();
    const run = async (): Promise<void> => {
      const startedAt = Date.now();
      try {
        await runCommand(options.runtime, options.send, request, {
          lane,
          timeoutMs: commandDeadlineMs,
          admit: options.admit,
          handlers,
        });
      } finally {
        reportSlowCommand(log, request.command.type, lane, queuedAt, startedAt, Date.now());
      }
    };
    if (lane === 'control' || lane === 'concurrent') {
      void trackCommand(run());
      return;
    }
    serializedChain = trackCommand(serializedChain.then(run));
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

  return {
    dispatch,
    drain,
    inFlightCommands: handlers.snapshot,
    reportLongRunningCommands: handlers.reportLongRunning,
  };
}

/**
 * A slow serialized command stalls every command queued behind it (session
 * switches included); the queue/run split shows which one held the lane.
 */
function reportSlowCommand(
  log: (line: string) => void,
  type: HostCommand['type'],
  lane: HostServeCommandLane,
  queuedAt: number,
  startedAt: number,
  finishedAt: number,
): void {
  if (finishedAt - queuedAt < HOST_SERVE_SLOW_COMMAND_MS) return;
  log(
    `[piwin host serve] slow command ${type} lane=${lane} queued=${startedAt - queuedAt}ms ran=${finishedAt - startedAt}ms`,
  );
}

async function runCommand(
  runtime: HostRuntime,
  send: HostServeSend,
  request: HostCommandRequest,
  options: {
    lane: HostServeCommandLane;
    timeoutMs: number | undefined;
    admit:
      | ((request: HostCommandRequest, execute: () => Promise<HostResponse>) => Promise<HostResponse>)
      | undefined;
    handlers: InFlightCommandTracker;
  },
): Promise<void> {
  const { timeoutMs, admit, handlers } = options;
  const command = request.command;
  const commandId = typeof command.id === 'string' ? command.id : undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    let handlerEntry: ReturnType<InFlightCommandTracker['begin']> | undefined;
    // Track the handler itself, not the deadline race: a timed-out handler
    // keeps running and is exactly what a hang investigation needs to see.
    const handle = (): Promise<HostResponse> => {
      const entry = handlers.begin(command.type, options.lane);
      handlerEntry = entry;
      const pending = request.idempotencyKey
        ? runtime.handleCommand(command, { idempotencyKey: request.idempotencyKey })
        : runtime.handleCommand(command);
      return pending.finally(() => {
        handlers.end(entry);
      });
    };
    const execute = (): Promise<HostResponse> =>
      timeoutMs === undefined
        ? handle()
        : Promise.race([
            handle(),
            new Promise<never>((_resolve, reject) => {
              timeoutId = setTimeout(() => {
                if (handlerEntry !== undefined) handlerEntry.timedOut = true;
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
