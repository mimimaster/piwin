/**
 * ADR 0015 host serve dispatcher: control lane bypasses serial work.
 * ADR 0027: transport-agnostic — takes a `send` function, not a JsonlWriter.
 */
import type { HostCommand, HostResponse, HostServerMessage } from '@piwin/contracts';
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
};

export type HostServeDispatcher = {
  dispatch: (command: HostCommand) => void;
  /** Stop accepting commands and await every queued or active command. */
  drain: () => Promise<void>;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;

export function createHostServeDispatcher(
  options: HostServeDispatcherOptions,
): HostServeDispatcher {
  const timeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  let serializedChain: Promise<void> = Promise.resolve();
  const inFlightCommands = new Set<Promise<void>>();
  let acceptingCommands = true;
  let drainPromise: Promise<void> | undefined;

  function dispatch(command: HostCommand): void {
    if (!acceptingCommands) {
      return;
    }
    const lane = classifyHostServeCommand(command);
    if (lane === 'control' || lane === 'concurrent') {
      void trackCommand(runCommand(options.runtime, options.send, command, timeoutMs));
      return;
    }
    serializedChain = trackCommand(
      serializedChain.then(() => runCommand(options.runtime, options.send, command, timeoutMs)),
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
  command: HostCommand,
  timeoutMs: number,
): Promise<void> {
  const commandId = typeof command.id === 'string' ? command.id : undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timeoutId.unref();
    });
    const response: HostResponse = await Promise.race([
      runtime.handleCommand(command),
      timeoutPromise,
    ]);
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
