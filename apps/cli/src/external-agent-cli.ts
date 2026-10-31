/**
 * CLI helpers for extension session backends. `piwin chat --agent <id>`
 * starts a session on an enabled extension backend. `pi` is the built-in agent.
 *
 * Documented CLI degradation: one-shot `chat` has no interactive approval
 * or typed-question surface. Permissions are answered with the reject option;
 * native questions are cancelled with an explicit Desktop/TUI route.
 */

import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';

const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseCliAgent(argv: readonly string[]): string | { error: string } {
  const index = argv.indexOf('--agent');
  if (index === -1) {
    return 'pi';
  }
  const value = argv[index + 1]?.trim() ?? '';
  if (!AGENT_ID.test(value)) {
    return { error: `--agent must be pi or a lowercase backend id (got ${value || 'nothing'})` };
  }
  return value;
}

/** Print a backend permission request and settle it with the reject option. */
export function createCliBackendPermissionResponder(
  request: (command: HostCommand) => Promise<HostResponse>,
  write: (line: string) => void = (line) => {
    process.stderr.write(line);
  },
): (push: HostPush) => boolean {
  return (push) => {
    if (push.type !== 'permission/request') {
      return false;
    }
    const options = push.context?.backendOptions;
    if (options === undefined || options.length === 0) {
      return false;
    }
    const labels = options.map((option) => `${option.label} [${option.optionId}]`).join(' | ');
    write(`\n[permission:${push.context?.backendAgentId ?? 'agent'}] ${push.context?.summary ?? push.action}\n  options: ${labels}\n`);
    const reject = options.find((option) => option.kind === 'reject_once' || option.kind === 'reject_always');
    if (reject === undefined) {
      write('  no reject option offered; leaving the request pending\n');
      return true;
    }
    write(`  one-shot CLI cannot approve interactively; answering "${reject.label}"\n`);
    void request({
      type: 'permission/resolve',
      requestId: push.requestId,
      decision: 'deny',
      backendOptionId: reject.optionId,
    }).then((response) => {
      if (!response.success) {
        write(`  [permission] resolve failed: ${response.error}\n`);
      }
    });
    return true;
  };
}

/** Print a native question and cancel it so one-shot chat never hangs. */
export function createCliBackendUserInputResponder(
  request: (command: HostCommand) => Promise<HostResponse>,
  write: (line: string) => void = (line) => {
    process.stderr.write(line);
  },
): (push: HostPush) => boolean {
  return (push) => {
    if (push.type !== 'session/backend-input-request') {
      return false;
    }
    write(
      `\n[input:${push.sessionId}] ${push.request.title}\n  one-shot CLI cannot answer native questions; use Desktop or \`piwin tui\`. Cancelling.\n`,
    );
    void request({
      type: 'session/backend-input-respond',
      sessionId: push.sessionId,
      requestId: push.requestId,
      generationId: push.generationId,
      result: { cancelled: true },
      ...(push.runId === undefined ? {} : { runId: push.runId }),
    }).then((response) => {
      if (!response.success) {
        write(`  [input] respond failed: ${response.error}\n`);
      }
    });
    return true;
  };
}
