/** Abort-aware waits shared by MCP connect and tool operations. */
export async function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    throw new Error('MCP operation aborted');
  }
  return new Promise<T>((resolve, reject) => {
    const abortHandler = (): void => {
      signal.removeEventListener('abort', abortHandler);
      reject(new Error('MCP operation aborted'));
    };
    signal.addEventListener('abort', abortHandler, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abortHandler);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abortHandler);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout: () => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abortHandler);
      onTimeout();
      reject(new Error(message));
    }, timeoutMs);
    const abortHandler = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortHandler);
      onTimeout();
      reject(new Error('MCP operation aborted'));
    };
    if (signal?.aborted) {
      abortHandler();
      return;
    }
    signal?.addEventListener('abort', abortHandler, { once: true });
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortHandler);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortHandler);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
