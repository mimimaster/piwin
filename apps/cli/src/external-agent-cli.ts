/**
 * CLI helpers for extension session backends. `piwin chat --agent <id>`
 * starts a session on an enabled extension backend. `pi` is the built-in agent.
 *
 * Documented CLI degradation: one-shot `chat` has no interactive approval
 * surface. When a backend asks, the CLI prints its options and answers with
 * the reject option, so nothing is ever approved silently.
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
