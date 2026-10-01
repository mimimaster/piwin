/**
 * Host-owned policy for every external agent backend (ADR 0082).
 *
 * Operations piwin implements on top of Pi are refused for external sessions
 * unless the adapter explicitly declares support in `session/new`. The rule is
 * agent-agnostic: adding a backend must not require a new Host branch.
 */
import type { SessionBackendCapabilities, SessionBackendOperation } from '@piwin/contracts';

/**
 * Host commands that only a Pi-backed session can serve, mapped to the
 * capability that gates them.
 */
export const EXTERNAL_AGENT_UNSUPPORTED_COMMANDS: ReadonlyMap<string, SessionBackendOperation> = new Map([
  ['session/fork', 'fork'],
  ['session/duplicate', 'duplicate'],
  ['session/pause', 'pause'],
  ['session/resume-run', 'pause'],
  ['session/compact', 'compact'],
  ['session/compact-export', 'compact'],
  ['session/branch-switch', 'conversationTree'],
  ['session/truncate-from', 'rewind'],
  ['session/retract-paused-prompt', 'pause'],
  ['session/follow_up', 'queue'],
  ['session/reload-runtime', 'hostTools'],
  ['session/set-auto-compaction', 'compact'],
]);

/**
 * Reasons used when the adapter has not described the operation itself. They
 * state the product truth (the Host does not implement this for external
 * agents) without inventing an agent-specific excuse.
 */
const GENERIC_REASONS: Readonly<Record<SessionBackendOperation, string>> = {
  prompt: 'Handled by the agent adapter',
  cancel: 'Handled by the agent adapter',
  queue: 'Queued turns are not available for external agent sessions',
  intervene: 'Handled by the agent adapter',
  setModel: 'Handled by the agent adapter',
  setEffort: 'Handled by the agent adapter',
  setMode: 'Handled by the agent adapter',
  slashCommands: 'Handled by the agent adapter',
  fileReferences: 'Handled by the agent adapter',
  images: 'This agent does not accept image input',
  rename: 'Handled by the agent adapter',
  delete: 'Handled by the agent adapter',
  archive: 'Handled by the agent adapter',
  pin: 'Handled by the agent adapter',
  export: 'Handled by the agent adapter',
  fork: 'External agent sessions cannot be forked',
  rewind: 'External agent sessions cannot be rewound',
  duplicate: 'External agent sessions cannot be duplicated',
  pause: 'This agent has no pause; use Stop',
  compact: 'Context compaction is managed by the agent',
  conversationTree: 'This agent keeps a linear history',
  coldStorage: 'This agent keeps its own session storage',
  hostSubagents: 'This agent runs its own subagents',
  hostTools: 'This agent uses its own tools and MCP servers',
};

export type ExternalOperationRefusal = { operation: SessionBackendOperation; reason: string };

/**
 * Why `commandType` is refused for this external session, or `undefined` when
 * the Host has no reason to refuse it. An adapter that declares support wins:
 * the Host only refuses what the backend says it cannot do.
 */
export function externalOperationRefusal(
  commandType: string,
  declared: SessionBackendCapabilities | undefined,
): ExternalOperationRefusal | undefined {
  const operation = EXTERNAL_AGENT_UNSUPPORTED_COMMANDS.get(commandType);
  if (operation === undefined) return undefined;
  const support = declared?.operations[operation];
  if (support?.supported === true) return undefined;
  return {
    operation,
    reason: support !== undefined && support.supported === false ? support.reason : GENERIC_REASONS[operation],
  };
}
