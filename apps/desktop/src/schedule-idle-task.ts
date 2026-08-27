/**
 * Run a low-priority task after the current frame, matching Chromium
 * settings-idle-load (`requestIdleCallback` with a timeout so a busy
 * main thread still eventually warms the likely-next chunk).
 */
export function scheduleIdleTask(task: () => void, timeoutMs = 2500): () => void {
  if (typeof requestIdleCallback === 'function') {
    const idleId = requestIdleCallback(() => {
      task();
    }, { timeout: timeoutMs });
    return () => {
      cancelIdleCallback(idleId);
    };
  }
  const timer = setTimeout(task, 0);
  return () => {
    clearTimeout(timer);
  };
}
