/**
 * `piwin agents` — the CLI half of the optional agent-backend loop (ADR 0082).
 *
 * Scope note (spec §2.1): piwin only automates an install recipe that has been
 * verified for the Host platform. No ACP probe has validated an official Grok
 * distribution recipe yet, so `install` prints the official guidance and asks
 * the user to re-run `agents check` afterwards instead of running an
 * unverified remote installer. Detection and login guidance are real.
 */
import type { ExternalAgentStatus } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { hasFlag, parseMock, parseMode, readOption } from './cli-args.js';
import { openCliHost } from './cli-host.js';

const USAGE = `Usage:
  piwin agents list [--mock]
  piwin agents check [--agent <id>] [--mock]
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
  | { kind: 'guide-install' }
  | { kind: 'unsupported'; sub: string }
  | { kind: 'query-host'; refresh: boolean }
  | { kind: 'usage' };

export function planAgentsSubcommand(sub: string): AgentsSubcommandPlan {
  switch (sub) {
    case 'install':
      // No verified official recipe for this Host → guidance, never a remote installer.
      return { kind: 'guide-install' };
    case 'enable':
    case 'disable':
    case 'uninstall':
      // The plugin inventory/ownership layer (plan slice 3) is not in this build.
      return { kind: 'unsupported', sub };
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

  if (plan.kind === 'guide-install') {
    console.log('piwin does not run an unverified installer for an agent runtime.');
    console.log('Install the agent CLI yourself, then re-check:');
    console.log('  1. install Grok Build with its official installer for this machine');
    console.log('  2. run: piwin agents check --agent grok');
    console.log('  3. run: piwin agents login --agent grok');
    return;
  }

  if (plan.kind === 'unsupported') {
    // Refusing beats pretending the agent was toggled.
    const agentId = agentIdOption(argv) ?? 'grok';
    console.error(
      `agents ${plan.sub}: the agent plugin inventory is not available in this build (agent: ${agentId}).`,
    );
    console.error('Nothing was changed. Session history and your agent CLI are untouched.');
    process.exitCode = 1;
    return;
  }

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
