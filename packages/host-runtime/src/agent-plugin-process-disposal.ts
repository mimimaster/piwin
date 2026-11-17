import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  cleanupProcessGroupGuardian,
  isChildProcessAlive,
  isUnixProcessGroupAlive,
  killWindowsProcessTree,
  signalUnixProcessGroup,
  waitForChildProcessExit,
  waitForUnixProcessGroupExit,
  type ProcessGroupGuardianHandle,
} from '@piwin/process';

const EXIT_GRACE_MS = 1_000;

/**
 * EOF lets the adapter release its own vendor transports before escalation
 * targets only this adapter's owned process group and closes the crash guardian.
 */
export async function disposeAgentPluginProcess(
  child: ChildProcessWithoutNullStreams,
  guardian: ProcessGroupGuardianHandle | null = null,
): Promise<void> {
  try {
    if (!child.stdin.destroyed) child.stdin.end();
    if (!(await waitForChildProcessExit(child, EXIT_GRACE_MS))) {
      await terminateUnresponsiveChild(child);
    }
    if (process.platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0) {
      await reapSurvivingUnixGroup(child.pid);
    }
  } finally {
    await cleanupProcessGroupGuardian(guardian, EXIT_GRACE_MS);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  }
}

async function terminateUnresponsiveChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;
  if (process.platform === 'win32' && typeof pid === 'number' && pid > 0) {
    await killWindowsProcessTree(pid, false);
    if (await waitForChildProcessExit(child, EXIT_GRACE_MS)) return;
    await killWindowsProcessTree(pid, true);
    if (isChildProcessAlive(child)) child.kill('SIGKILL');
    if (!(await waitForChildProcessExit(child, EXIT_GRACE_MS))) {
      throw new AgentPluginProcessCleanupError();
    }
    return;
  }

  if (typeof pid === 'number' && pid > 0) {
    if (!signalUnixProcessGroup(pid, 'SIGTERM')) child.kill('SIGTERM');
    if (await waitForChildProcessExit(child, EXIT_GRACE_MS)) return;
    if (!signalUnixProcessGroup(pid, 'SIGKILL')) child.kill('SIGKILL');
    if (!(await waitForChildProcessExit(child, EXIT_GRACE_MS))) {
      throw new AgentPluginProcessCleanupError();
    }
    return;
  }

  child.kill('SIGTERM');
  if (await waitForChildProcessExit(child, EXIT_GRACE_MS)) return;
  child.kill('SIGKILL');
  if (!(await waitForChildProcessExit(child, EXIT_GRACE_MS))) {
    throw new AgentPluginProcessCleanupError();
  }
}

async function reapSurvivingUnixGroup(processGroupId: number): Promise<void> {
  if (!isUnixProcessGroupAlive(processGroupId)) return;
  signalUnixProcessGroup(processGroupId, 'SIGTERM');
  if (await waitForUnixProcessGroupExit(processGroupId, EXIT_GRACE_MS)) return;
  signalUnixProcessGroup(processGroupId, 'SIGKILL');
  await waitForUnixProcessGroupExit(processGroupId, EXIT_GRACE_MS);
}

class AgentPluginProcessCleanupError extends Error {
  override readonly name = 'AgentPluginProcessCleanupError';
  constructor() { super('owned agent plugin process did not exit after SIGKILL'); }
}
