import { BUILTIN_AUTO_SCHEME } from './orchestration-scheme-auto.js';
import { BUILTIN_FUSION_SCHEME } from './orchestration-scheme-fusion.js';
import {
  LEGACY_ULTRA_CODE_SCOUT_ROLE,
  ULTRA_CODE_SCHEME_ID,
  ULTRA_CODE_SCOUT_ROLE,
} from './orchestration-scheme-ids.js';
import { ULTRA_CODE_SCOUT_REPORT_CONTRACT } from './orchestration-scheme-resolved.js';
import { BUILTIN_REVIEWED_DELIVERY_SCHEME } from './orchestration-scheme-reviewed-delivery.js';
import type {
  OrchestrationScheme,
  OrchestrationSchemeConfigSlice,
  OrchestrationSchemeMember,
  OrchestrationSchemeSettings,
} from './orchestration-scheme-types.js';

const ULTRA_CODE_SCOUT_DESCRIPTION =
  'Read-only scout for wide/heavy reads to prevent main context rot: locating symbols, tracing call/type/import relationships, cross-file search, huge files, and parallel investigations. Returns a dense evidence report with file:line citations; never edits files or makes architectural decisions.';

/**
 * Main-agent discipline (Codex AGENTS.md analogue). Injected only when Ultra
 * Code is selected for the turn. Covers when to spawn, when not to, wait, and
 * how to verify compressed scout reports.
 */
const ULTRA_CODE_PREAMBLE = `<orchestration_discipline scheme="ultra-code">
You are the composer agent: orchestrate, synthesize, and decide. Prevent context rot in this thread by delegating wide reads.

## Delegation Policy
- **Delegate (role="scout")**: Broad symbol discovery, cross-file call/import tracing, large files/logs, or independent parallel investigations.
- **Start early**: Use \`piwin_subagent_start\` to kick off independent scouts in parallel, then continue useful parent work in this thread.
- **Single-task convenience**: Use \`piwin_subagent_run\` when one synchronous spawn-and-merge scout is enough.
- **Collect once**: Call \`piwin_subagent_wait\` exactly once to gather every required scout report before synthesizing.
- **Cancel sparingly**: Use \`piwin_subagent_cancel\` only for work proven unnecessary — never to skip required evidence.
- **Do NOT Delegate**: Known small files, foundational docs, or the exact file you are about to edit. Read these directly.

## Execution & Verification
1. **Self-Contained Tasks**: Provide precise scope, target question, and required evidence format in the delegated task text.
2. **Verify via Citations**: Treat scout findings as compressed clues. Spot-check by sampling cited \`file:line\` locations—do NOT re-read the raw search dumps.
3. **Scout Boundary**: Scouts are strictly read-only and cannot edit, decide architecture, or spawn child agents.
</orchestration_discipline>`;

/**
 * Builtin Ultra Code: article-aligned scout pack (single scout template +
 * wait discipline + soft generic). Users may overlay-edit via settings.
 */
export const BUILTIN_ULTRA_CODE_SCHEME: OrchestrationScheme = {
  id: ULTRA_CODE_SCHEME_ID,
  name: 'Ultra Code',
  description:
    'Built-in scout pack for high-effort main agents: cheap readonly scout, low thinking, wait-for-scouts discipline',
  source: 'builtin',
  defaultRole: ULTRA_CODE_SCOUT_ROLE,
  defaultProfileId: 'explorer',
  exposeSpawnMetadata: false,
  maxConcurrency: 6,
  maxTasksPerRun: 8,
  waitPolicy: 'await-all',
  maxSubagentThinkingLevel: 'low',
  members: [
    {
      role: ULTRA_CODE_SCOUT_ROLE,
      description: ULTRA_CODE_SCOUT_DESCRIPTION,
      profileId: 'explorer',
      thinkingLevel: 'low',
      isolation: 'readonly',
      fallback: 'main',
      reportContract: ULTRA_CODE_SCOUT_REPORT_CONTRACT,
    },
  ],
  systemPreamble: ULTRA_CODE_PREAMBLE,
};

export const BUILTIN_SCHEMES: readonly OrchestrationScheme[] = [
  BUILTIN_ULTRA_CODE_SCHEME,
  BUILTIN_REVIEWED_DELIVERY_SCHEME,
  BUILTIN_FUSION_SCHEME,
  BUILTIN_AUTO_SCHEME,
];

/**
 * Default role seeds for new user schemes (Settings "add role" templates).
 * Not auto-inserted into every scheme — UI may offer these as starters.
 */
export const DEFAULT_ORCHESTRATION_ROLE_TEMPLATES: readonly OrchestrationSchemeMember[] = [
  {
    role: ULTRA_CODE_SCOUT_ROLE,
    description: ULTRA_CODE_SCOUT_DESCRIPTION,
    profileId: 'explorer',
    isolation: 'readonly',
    thinkingLevel: 'low',
    fallback: 'main',
    reportContract: ULTRA_CODE_SCOUT_REPORT_CONTRACT,
  },
  {
    role: 'coder',
    description:
      'Implement changes in an isolated worktree. Return what changed and how to verify; do not own final product decisions.',
    profileId: 'implementer',
    isolation: 'worktree',
    fallback: 'main',
  },
  {
    role: 'reviewer',
    description:
      'Read-only review for correctness, security, and missing tests. Lead with concrete findings.',
    profileId: 'reviewer',
    isolation: 'readonly',
    fallback: 'main',
  },
  {
    role: 'tester',
    description:
      'Run tests and reproduce failures in isolation. Report failing commands and likely causes.',
    profileId: 'tester',
    isolation: 'worktree',
    fallback: 'main',
  },
] as const;

/**
 * Map the retired Ultra Code role `searcher` onto `scout`. Custom schemes may
 * still use `searcher` as their own role id.
 */
export function canonicalizeOrchestrationRole(schemeId: string, role: string): string {
  if (schemeId === ULTRA_CODE_SCHEME_ID && role === LEGACY_ULTRA_CODE_SCOUT_ROLE) {
    return ULTRA_CODE_SCOUT_ROLE;
  }
  return role;
}

/**
 * Rewrite an ultra-code overlay that still stores `searcher` so Settings and
 * resolve see `scout`. Leaves `searcher` in place only if the overlay already
 * has a `scout` member (user added both).
 */
export function canonicalizeUltraCodeSchemeSettings<T extends OrchestrationSchemeSettings>(
  scheme: T,
): T {
  if (scheme.id !== ULTRA_CODE_SCHEME_ID) return scheme;
  const members = scheme.members;
  if (members && members.length > 0) {
    const hasScout = members.some((member) => member.role.trim() === ULTRA_CODE_SCOUT_ROLE);
    const nextMembers = members.map((member) => {
      const role = member.role.trim();
      if (role === LEGACY_ULTRA_CODE_SCOUT_ROLE && !hasScout) {
        return { ...member, role: ULTRA_CODE_SCOUT_ROLE };
      }
      return member;
    });
    const defaultRoleRaw = scheme.defaultRole?.trim();
    const defaultRole =
      defaultRoleRaw === LEGACY_ULTRA_CODE_SCOUT_ROLE &&
      nextMembers.some((member) => member.role === ULTRA_CODE_SCOUT_ROLE)
        ? ULTRA_CODE_SCOUT_ROLE
        : defaultRoleRaw;
    return {
      ...scheme,
      members: nextMembers,
      ...(defaultRole ? { defaultRole } : {}),
    };
  }
  if (scheme.defaultRole?.trim() === LEGACY_ULTRA_CODE_SCOUT_ROLE) {
    return { ...scheme, defaultRole: ULTRA_CODE_SCOUT_ROLE };
  }
  return scheme;
}

/**
 * Merge builtin schemes with Settings schemes. Settings with the same id
 * override builtin fields (source becomes settings). Settings-only schemes
 * append after builtins.
 */
export function listOrchestrationSchemes(
  config: OrchestrationSchemeConfigSlice,
): OrchestrationScheme[] {
  const settingsSchemes = (config.schemes ?? []).map((scheme) =>
    canonicalizeUltraCodeSchemeSettings(scheme),
  );
  const byId = new Map<string, OrchestrationScheme>();
  for (const builtin of BUILTIN_SCHEMES) {
    byId.set(builtin.id, { ...builtin, source: 'builtin' });
  }
  for (const settingsScheme of settingsSchemes) {
    byId.set(settingsScheme.id, { ...settingsScheme, source: 'settings' });
  }
  const ordered: OrchestrationScheme[] = [];
  const builtinIds = new Set(BUILTIN_SCHEMES.map((scheme) => scheme.id));
  for (const builtin of BUILTIN_SCHEMES) {
    const resolved = byId.get(builtin.id);
    if (resolved) ordered.push(resolved);
  }
  for (const settingsScheme of settingsSchemes) {
    if (!builtinIds.has(settingsScheme.id)) {
      const resolved = byId.get(settingsScheme.id);
      if (resolved) ordered.push(resolved);
    }
  }
  return ordered;
}
