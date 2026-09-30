/**
 * `piwin agents` — the CLI half of the optional agent-backend loop (ADR 0082).
 *
 * Installs the reviewed declarative adapter through the Host. CLI dependency
 * installation remains manual on unverified distributions; uninstall removes
 * only the adapter, preserving history and the user's own runtime.
 */
import type { AgentPluginInstallation, ExternalAgentStatus, HostCommand } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { hasFlag, parseMock, parseMode, readOption } from './cli-args.js';
import { newCliGestureKey, openCliHost } from './cli-host.js';

const USAGE = `Usage:
  piwin agents list [--mock]
  piwin agents check [--agent <id>] [--path <absolute-host-cli>] [--mock]
  piwin agents install [--agent <id>]
  piwin agents login [--agent <id>] [--mock]
  piwin agents enable|disable|uninstall --agent <id>`;

function agentIdOption(argv: string[]): string | undefined {
  return readOption(argv, '--agent');
}

function readAgents(data: unknown): ExternalAgentStatus[] {
  const agents = (data as { agents?: ExternalAgentStatus[] } | undefined)?.agents;
  return Array.isArray(agents) ? agents : [];
}

/** What the CLI should do for a subcommand; pure so it stays unit-testable. */
export type AgentsSubcommandPlan =
  | { kind: 'mutate-host'; sub: 'install' | 'enable' | 'disable' | 'uninstall' }
  | { kind: 'query-host'; refresh: boolean }
  | { kind: 'usage' };

export function planAgentsSubcommand(sub: string): AgentsSubcommandPlan {
  switch (sub) {
    case 'install':
    case 'enable':
    case 'disable':
    case 'uninstall':
      return { kind: 'mutate-host', sub };
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
    if (plan.kind === 'mutate-host') {
      const agentId = requested ?? 'grok';
      if (agentId !== 'grok') throw new Error(`Unknown agent: ${agentId}`);
      const command: HostCommand = plan.sub === 'install'
        ? { type: 'agents/install', source: { kind: 'bundled', agentId: 'grok' } }
        : plan.sub === 'uninstall'
          ? { type: 'agents/uninstall', agentId }
          : { type: 'agents/set-enabled', agentId, enabled: plan.sub === 'enable' };
      const response = await runtime.handleCommand(command, newCliGestureKey());
      if (!response.success) { console.error(formatError(response.error)); process.exitCode = 1; return; }
      console.log(`Agent adapter ${plan.sub} succeeded on the Host. History and user-owned CLI are preserved.`);
      if (plan.sub === 'install') console.log('Install the official Grok CLI if missing, run grok login on the Host, then: piwin agents check --agent grok');
      return;
    }
    if (sub === 'list') {
      const response = await runtime.handleCommand({ type: 'agents/list' });
      if (!response.success) { console.error(formatError(response.error)); process.exitCode = 1; return; }
      const plugins = (response.data as { plugins: AgentPluginInstallation[] }).plugins;
      const selected = plugins.filter((plugin) => requested === undefined || plugin.agentId === requested);
      for (const plugin of selected) console.log(`${plugin.agentId}\tadapter v${plugin.manifest.version}\t${plugin.enabled ? 'enabled' : 'disabled'}\truntime: ${plugin.runtime.binaryPath ?? 'not checked'}`);
      if (selected.length === 0) console.log('(no agent adapters installed)');
      return;
    }
    const binaryPath = readOption(argv, '--path');
    if (binaryPath !== undefined) {
      const selected = await runtime.handleCommand({ type: 'agents/select-runtime', agentId: requested ?? 'grok', binaryPath }, newCliGestureKey());
      if (!selected.success) { console.error(formatError(selected.error)); process.exitCode = 1; return; }
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
        console.log('Install the agent CLI first: piwin agents install --agent grok');
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
        console.log('  start a session with: piwin chat --agent grok "<task>"');
      }
    }
  } finally {
    await runtime.dispose();
  }

  if (hasFlag(argv, '--mock')) {
    console.log('(mock host: detection results are synthetic)');
  }
}
