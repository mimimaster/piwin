const DEFAULT_PI_HTTP_IDLE_TIMEOUT_MS = 300_000;

type PiRawEvent = {
  type?: unknown;
};

export class PiStreamProgressTimeoutError extends Error {
  constructor(timeoutMs: number) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    super(
      `Model stream stalled: no model progress was received for ${seconds} seconds while the connection remained open.`,
    );
    this.name = 'PiStreamProgressTimeoutError';
  }
}

export function readPiHttpIdleTimeoutMs(settingsManager: unknown): number {
  if (!isObject(settingsManager)) return DEFAULT_PI_HTTP_IDLE_TIMEOUT_MS;
  const getter = Reflect.get(settingsManager, 'getHttpIdleTimeoutMs');
  if (typeof getter !== 'function') return DEFAULT_PI_HTTP_IDLE_TIMEOUT_MS;
  const value = Reflect.apply(getter, settingsManager, []);
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_PI_HTTP_IDLE_TIMEOUT_MS;
}

/**
 * Pi's HTTP idle timeout measures raw response bytes. SSE comments such as
 * `: keep-alive` therefore keep the socket alive even when the model has
 * stopped producing parsed events. This companion uses the same Pi setting,
 * but only while one native assistant message is actively streaming.
 */
export async function runPiPromptWithProgressTimeout(input: {
  timeoutMs: number;
  prompt: () => Promise<void>;
  abort: () => Promise<void>;
  subscribe: (listener: (event: unknown) => void) => () => void;
}): Promise<void> {
  if (input.timeoutMs === 0) {
    await input.prompt();
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout: ((error: Error) => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });

  const disarm = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const arm = (): void => {
    disarm();
    timer = setTimeout(() => {
      timer = undefined;
      rejectTimeout?.(new PiStreamProgressTimeoutError(input.timeoutMs));
      void input.abort().catch(() => undefined);
    }, input.timeoutMs);
  };

  const unsubscribe = input.subscribe((event) => {
    const type = isObject(event) ? (event as PiRawEvent).type : undefined;
    switch (type) {
      case 'message_start':
      case 'message_update':
        arm();
        break;
      case 'message_end':
      case 'agent_end':
        disarm();
        break;
      default:
        break;
    }
  });

  try {
    await Promise.race([input.prompt(), timeout]);
  } finally {
    disarm();
    unsubscribe();
  }
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
