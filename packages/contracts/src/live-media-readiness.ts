/** Portable readiness gate. Shells provide media state; no browser/vendor types cross this port. */
export function waitForLiveMediaReady(input: {
  read: () => 'pending' | 'ready' | 'failed';
  subscribe: (listener: () => void) => () => void;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = (): void => undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      unsubscribe();
      input.signal.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = (): void => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      finish(error);
    };
    const check = (): void => {
      if (input.signal.aborted) { onAbort(); return; }
      const state = input.read();
      if (state === 'ready') finish();
      else if (state === 'failed') finish(new Error('live-protocol-failed'));
    };
    input.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(new Error('live-protocol-failed')), input.timeoutMs ?? 15_000);
    unsubscribe = input.subscribe(check);
    if (settled) unsubscribe();
    else check();
  });
}
