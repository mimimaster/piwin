/**
 * Host custom tool: piwin_scheme_playbook.
 *
 * Progressive disclosure layer L1 (spec orchestration-scheme-auto.zh.md §4):
 * the resident scheme preamble names roles and routing only; the exact loop
 * for a role is fetched here, once per role per run.
 */
import {
  AUTO_ROLE_PLAYBOOKS,
  AUTO_SCHEME_ID,
  PIWIN_SCHEME_PLAYBOOK_TOOL_NAME,
  formatAutoRolePlaybook,
  type HostToolRegistration,
  type ResolvedOrchestrationScheme,
} from '@piwin/contracts';

const MAX_TRACKED_PLAYBOOK_LOADS = 512;

export type SchemePlaybookToolOptions = {
  getActiveScheme: (runId: string) => ResolvedOrchestrationScheme | undefined;
};

/** Playbook text for one role of the run's scheme, or why there is none. */
export function formatSchemePlaybook(
  scheme: ResolvedOrchestrationScheme | undefined,
  role: string,
): string {
  if (!scheme) {
    return 'No orchestration scheme is active for this turn; there is no playbook to load.';
  }
  if (scheme.schemeId !== AUTO_SCHEME_ID) {
    return `Scheme "${scheme.schemeId}" has no separate playbooks; its discipline block already holds the full loop.`;
  }
  const member = scheme.members.find((candidate) => candidate.role === role.trim());
  const playbook = formatAutoRolePlaybook(role);
  if (!member || !AUTO_ROLE_PLAYBOOKS[role.trim()]) return playbook;
  if (!member.available) {
    return `${playbook}\nNote: role "${member.role}" is unavailable (${member.unavailableReason ?? 'unknown'}); do this part yourself.`;
  }
  return playbook;
}

export function createSchemePlaybookTool(options: SchemePlaybookToolOptions): HostToolRegistration {
  const loaded = new Set<string>();
  return {
    descriptor: {
      name: PIWIN_SCHEME_PLAYBOOK_TOOL_NAME,
      description: 'Load the exact loop for one role of the active orchestration scheme.',
      parameters: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            description: 'Roster role name.',
          },
        },
        required: ['role'],
        additionalProperties: false,
      },
    },
    family: 'delegate',
    permissionSpec: {
      action: 'subagent:playbook',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    async execute(args, _signal, context) {
      const role =
        typeof args === 'object' && args !== null && 'role' in args && typeof args.role === 'string'
          ? args.role.trim()
          : '';
      if (!role) {
        return { ok: false, code: 'invalid-input', message: 'role is required' };
      }
      const loadKey = `${context.sessionId}\u0000${context.runId}\u0000${role}`;
      if (loaded.has(loadKey)) {
        return {
          ok: true,
          output: `Playbook for "${role}" is already loaded in this turn. Reuse the earlier result.`,
        };
      }
      loaded.add(loadKey);
      if (loaded.size > MAX_TRACKED_PLAYBOOK_LOADS) {
        const oldest = loaded.values().next().value;
        if (oldest !== undefined) loaded.delete(oldest);
      }
      return { ok: true, output: formatSchemePlaybook(options.getActiveScheme(context.runId), role) };
    },
  };
}
