/**
 * CLI helpers for external agents (ADR 0082). `piwin chat --agent grok`
 * runs one turn on Grok Build through the local Host.
 *
 * Documented CLI degradation: one-shot `chat` has no interactive approval
 * surface. When Grok asks (its own permission mode decides whether it
 * does), the CLI prints Grok's options and answers with Grok's reject
 * option, so nothing is ever approved silently. Configure Grok with
 * `/always-approve on` or run interactive sessions in Desktop for approvals.
 */

import type { HostCommand, HostPush, HostResponse } from '@piwin/contracts';

export type CliAgentId = 'pi' | 'grok';

export function parseCliAgent(argv: readonly string[]): CliAgentId | { error: string } {
  const index = argv.indexOf('--agent');
  if (index === -1) {
    return 'pi';
  }
  const value = argv[index + 1]?.trim();
  if (value === 'pi' || value === 'grok') {
    return value;
  }
  return { error: `--agent must be pi or grok (got ${value ?? 'nothing'})` };
}

/** Print a Grok permission request and settle it with Grok's reject option. */
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
