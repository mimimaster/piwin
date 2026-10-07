/** Bound startup waits that the browser/native API itself cannot cancel. */
export function waitForLiveStart<Result>(input: {
  work: Promise<Result>;
  signal?: AbortSignal;
  timeoutMs: number;
  timeoutCode: string;
  releaseLate?: (result: Result) => void;
}): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      complete();
    };
    const onAbort = (): void => finish(() => reject(new DOMException('aborted', 'AbortError')));
    const timer = setTimeout(() => finish(() => reject(new Error(input.timeoutCode))), input.timeoutMs);
    input.signal?.addEventListener('abort', onAbort, { once: true });
    // Always observe the unabortable operation, including after cancellation.
    void input.work.then(
      (result) => {
        if (settled) input.releaseLate?.(result);
        else finish(() => resolve(result));
      },
      (error: unknown) => finish(() => reject(error)),
    );
    if (input.signal?.aborted) onAbort();
  });
}
