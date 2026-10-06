import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const EXIT_GRACE_MS = 1_000;

/** EOF lets the adapter release its own vendor transports before escalation targets only this child. */
export async function disposeAgentPluginProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  try {
    if (!child.stdin.destroyed) child.stdin.end();
    if (await waitForExit(child)) return;
    child.kill('SIGTERM');
    if (await waitForExit(child)) return;
    child.kill('SIGKILL');
    if (!await waitForExit(child)) throw new AgentPluginProcessCleanupError();
  } finally {
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  }
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), EXIT_GRACE_MS);
    const finish = (exited: boolean): void => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    child.once('exit', onExit);
  });
}

class AgentPluginProcessCleanupError extends Error {
  override readonly name = 'AgentPluginProcessCleanupError';
  constructor() { super('owned agent plugin process did not exit after SIGKILL'); }
}
