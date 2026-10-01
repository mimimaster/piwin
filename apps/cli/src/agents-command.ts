/**
 * `piwin agents` — status and extension-backed enablement for session backends.
 *
 * Install is not a second inventory. A backend is an ordinary extension.
 */
import type { ExtensionSummary, ExternalAgentStatus, HostCommand } from '@piwin/contracts';
import { enabledExtensionSessionBackends, formatError } from '@piwin/contracts';
import { hasFlag, parseMock, parseMode, readOption } from './cli-args.js';
import { newCliGestureKey, openCliHost } from './cli-host.js';

const USAGE = `Usage:
  piwin agents list [--mock]
  piwin agents check [--agent <id>] [--mock]
  piwin agents login [--agent <id>] [--mock]
  piwin agents enable|disable|uninstall --agent <id>

Install a session backend as an extension. This command does not install a bundled adapter.`;

function agentIdOption(argv: string[]): string | undefined {
  return readOption(argv, '--agent');
}

function readAgents(data: unknown): ExternalAgentStatus[] {
  const agents = (data as { agents?: ExternalAgentStatus[] } | undefined)?.agents;
  return Array.isArray(agents) ? agents : [];
}

/** What the CLI should do for a subcommand; pure so it stays unit-testable. */
export type AgentsSubcommandPlan =
  | { kind: 'extension-install' }
  | { kind: 'extension-lifecycle'; sub: 'enable' | 'disable' | 'uninstall' }
  | { kind: 'query-host'; refresh: boolean }
  | { kind: 'usage' };

export function planAgentsSubcommand(sub: string): AgentsSubcommandPlan {
  switch (sub) {
    case 'install':
      return { kind: 'extension-install' };
    case 'enable':
    case 'disable':
    case 'uninstall':
      return { kind: 'extension-lifecycle', sub };
    case 'list':
      return { kind: 'query-host', refresh: false };
    case 'check':
    case 'login':
      // Both must re-probe; `login` additionally prints Host-side sign-in steps.
      return { kind: 'query-host', refresh: true };
    default:
      return { kind: 'usage' };
  }
}

export function describeAgent(status: ExternalAgentStatus): string {
  switch (status.state) {
    case 'not-installed':
      return `not installed (searched: ${status.searched.join(', ') || 'default PATH'})`;
    case 'unavailable':
      return `unavailable — ${status.reason} (${status.binaryPath})`;
    case 'unauthenticated':
      return `installed v${status.version} at ${status.binaryPath} — sign-in required`;
    case 'ready':
      return `ready — v${status.version} at ${status.binaryPath} (${status.supportStatus})`;
  }
}

export async function commandAgents(argv: string[]): Promise<void> {
  const sub = argv[1] ?? 'list';
  const plan = planAgentsSubcommand(sub);

  if (plan.kind === 'usage') {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const runtime = await openCliHost({
    mode: parseMode(argv),
    mock: parseMock(argv),
  });
  try {
    const requested = agentIdOption(argv);
    if (plan.kind === 'extension-install') {
      console.error('Session backends install as extensions. This build does not ship a bundled agent adapter.');
      process.exitCode = 1;
      return;
    }
    const listed = await runtime.handleCommand({ type: 'extensions/list' });
    if (!listed.success) { console.error(formatError(listed.error)); process.exitCode = 1; return; }
    const extensions = ((listed.data as { extensions?: ExtensionSummary[] }).extensions) ?? [];
    if (plan.kind === 'extension-lifecycle') {
      if (requested === undefined) throw new Error('--agent is required');
      const match = extensions.find((extension) => extension.sessionBackend?.id === requested);
      if (match === undefined) throw new Error(`No installed extension declares backend "${requested}"`);
      const command: HostCommand = plan.sub === 'uninstall'
        ? { type: 'extensions/uninstall', extensionId: match.id }
        : { type: 'extensions/set_enabled', extensionId: match.id, enabled: plan.sub === 'enable' };
      const response = await runtime.handleCommand(command, newCliGestureKey());
      if (!response.success) { console.error(formatError(response.error)); process.exitCode = 1; return; }
      console.log(`${match.id}\t${plan.sub}\tbackend ${requested}`);
      return;
    }
    if (sub === 'list') {
      const rows = extensions.filter((extension) => extension.sessionBackend !== undefined
        && (requested === undefined || extension.sessionBackend.id === requested));
      for (const extension of rows) {
        const backend = extension.sessionBackend;
        if (backend === undefined) continue;
        console.log(`${backend.id}\t${backend.name}\t${extension.enabled ? 'enabled' : 'disabled'}\textension ${extension.id}`);
      }
      const enabled = enabledExtensionSessionBackends(rows);
      if (enabled.length === 0) console.log('(no enabled session-backend extensions)');
      return;
    }
    const response = await runtime.handleCommand({
      type: 'agents/status',
      ...(requested !== undefined ? { agentId: requested } : {}),
      ...(plan.refresh ? { refresh: true } : {}),
    });
    if (!response.success) {
      console.error(formatError(response.error));
      process.exitCode = 1;
      return;
    }

    const agents = readAgents(response.data);
    if (agents.length === 0) {
      console.log('(no external agents configured)');
      if (sub === 'login') {
        console.log('Install the backend as an extension, then install its own CLI on the Host.');
      }
      return;
    }

    for (const status of agents) {
      console.log(`${status.agentId}\t${describeAgent(status)}`);
      if (status.state === 'ready' && status.defaultAuthMethodId !== undefined) {
        console.log(`  auth: ${status.defaultAuthMethodId}`);
      }
      if (sub === 'login' && status.state !== 'ready') {
        console.log('  sign-in runs on the Host machine through the agent\u2019s own CLI:');
        console.log(`    ${status.state === 'not-installed' ? 'install the CLI first' : 'run the agent\u2019s own login command on this machine'}`);
        console.log('  then re-run: piwin agents check');
      }
      if (status.state === 'ready' && sub === 'check') {
        console.log(`  start a session with: piwin chat --agent ${status.agentId} "<task>"`);
      }
    }
  } finally {
    await runtime.dispose();
  }

  if (hasFlag(argv, '--mock')) {
    console.log('(mock host: detection results are synthetic)');
  }
}
