/**
 * Build slash catalog from static commands, agent modes, and skills list.
 */
import { AGENT_MODES, type AgentModeId } from '../agent-mode';
import type { SlashItem } from './slash-types';

export type SlashSkillInput = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
};

export type BuildSlashCatalogOptions = {
  skills: SlashSkillInput[];
  /** Host capabilities.compaction when known; default true for mock/sdk. */
  compactionSupported?: boolean;
  streaming?: boolean;
  compacting?: boolean;
  hasActiveSession?: boolean;
  projectTrusted?: boolean;
  /** Current agent mode (for availability UI only). */
  agentMode?: AgentModeId;
};

/**
 * Reserved command names win over skills with the same token.
 */
export const RESERVED_SLASH_COMMAND_NAMES: ReadonlySet<string> = new Set([
  'compact',
  'summarize',
  'compress',
  'stop',
  'abort',
  'agent',
  'plan',
  'ask',
  'scheme',
  'ultra-code',
]);

/**
 * Skill alias map: alias slash name → canonical skill id. Aliases appear in
 * the autocomplete menu attached to the canonical skill item and resolve in
 * parseComposerSlashSubmit. Keep one canonical skill asset per alias.
 */
export const SKILL_SLASH_ALIASES: Record<string, string> = {
  'write-plan': 'writing-plans',
};

export function buildSlashCatalog(options: BuildSlashCatalogOptions): SlashItem[] {
  const compactionSupported = options.compactionSupported !== false;
  const streaming = options.streaming === true;
  const compacting = options.compacting === true;
  const hasActiveSession = options.hasActiveSession === true;
  const projectTrusted = options.projectTrusted === true;
  const interactive = hasActiveSession && projectTrusted;

  const items: SlashItem[] = [];

  // --- Commands ---
  {
    let available = true;
    let unavailableReason: string | undefined;
    if (!interactive) {
      available = false;
      unavailableReason = !hasActiveSession
        ? 'Start or select a session first'
        : 'Trust the project first';
    } else if (!compactionSupported) {
      available = false;
      unavailableReason = 'Compaction is not supported in this host mode';
    } else if (streaming) {
      available = false;
      unavailableReason = 'Wait for the current run to finish';
    } else if (compacting) {
      available = false;
      unavailableReason = 'Compaction already running';
    }
    const compactItem: SlashItem = {
      id: 'cmd:compact',
      kind: 'command',
      name: 'compact',
      aliases: ['summarize', 'compress'],
      label: 'Compact context',
      description: 'Summarize older context to free the window (Pi compaction)',
      keywords: ['compress', 'summarize', 'context', 'tokens'],
      groupLabel: 'Command',
      available,
      acceptsArgs: true,
    };
    if (unavailableReason) {
      compactItem.unavailableReason = unavailableReason;
    }
    items.push(compactItem);
  }

  {
    let available = true;
    let unavailableReason: string | undefined;
    if (!interactive) {
      available = false;
      unavailableReason = !hasActiveSession
        ? 'Start or select a session first'
        : 'Trust the project first';
    } else if (!streaming) {
      available = false;
      unavailableReason = 'Nothing is running to stop';
    }
    const stopItem: SlashItem = {
      id: 'cmd:stop',
      kind: 'command',
      name: 'stop',
      aliases: ['abort'],
      label: 'Stop',
      description: 'Abort the current agent run',
      keywords: ['abort', 'cancel', 'halt'],
      groupLabel: 'Command',
      available,
    };
    if (unavailableReason) {
      stopItem.unavailableReason = unavailableReason;
    }
    items.push(stopItem);
  }

  // --- Orchestration scheme (per-send opt-in) ---
  {
    let available = true;
    let unavailableReason: string | undefined;
    if (!interactive) {
      available = false;
      unavailableReason = !hasActiveSession
        ? 'Start or select a session first'
        : 'Trust the project first';
    }
    items.push({
      id: 'cmd:scheme',
      kind: 'command',
      name: 'scheme',
      label: 'Orchestration scheme',
      description: 'Set per-send scheme: /scheme off | ultra-code',
      keywords: ['orchestration', 'ultra', 'subagent', 'scheme'],
      groupLabel: 'Command',
      available,
      acceptsArgs: true,
      ...(unavailableReason ? { unavailableReason } : {}),
    });
    items.push({
      id: 'cmd:ultra-code',
      kind: 'command',
      name: 'ultra-code',
      label: 'Ultra Code scheme',
      description: 'Select Ultra Code orchestration for the next send',
      keywords: ['orchestration', 'ultra', 'scheme'],
      groupLabel: 'Command',
      available,
      ...(unavailableReason ? { unavailableReason } : {}),
    });
  }

  // --- Modes ---
  for (const mode of AGENT_MODES) {
    items.push({
      id: `mode:${mode.id}`,
      kind: 'mode',
      name: mode.id,
      label: mode.label,
      description: mode.description,
      keywords: [mode.title, mode.id],
      groupLabel: 'Mode',
      available: interactive,
      ...(interactive
        ? {}
        : {
            unavailableReason: !hasActiveSession
              ? 'Start or select a session first'
              : 'Trust the project first',
          }),
    });
  }

  // --- Skills (skip names reserved by commands/modes) ---
  for (const skill of options.skills) {
    const token = skill.name.trim() || skill.id;
    const lower = token.toLowerCase();
    if (RESERVED_SLASH_COMMAND_NAMES.has(lower)) {
      continue;
    }
    const enabled = skill.enabled !== false;
    let available = interactive && enabled;
    let unavailableReason: string | undefined;
    if (!interactive) {
      unavailableReason = !hasActiveSession
        ? 'Start or select a session first'
        : 'Trust the project first';
      available = false;
    } else if (!enabled) {
      unavailableReason = 'Enable this skill in Settings → Skills';
      available = false;
    }
    const skillItem: SlashItem = {
      id: `skill:${skill.id}`,
      kind: 'skill',
      name: token,
      label: token,
      description: skill.description?.trim() || `Run skill ${token}`,
      keywords: [skill.id, token],
      groupLabel: 'Skill',
      enabled,
      available,
    };
    // Attach any aliases registered for this canonical skill id.
    const aliasNames = Object.entries(SKILL_SLASH_ALIASES)
      .filter(([, target]) => target.toLowerCase() === skill.id.toLowerCase())
      .map(([alias]) => alias);
    if (aliasNames.length > 0) {
      skillItem.aliases = aliasNames;
      for (const alias of aliasNames) {
        if (skillItem.keywords && !skillItem.keywords.includes(alias)) {
          skillItem.keywords.push(alias);
        }
      }
    }
    if (unavailableReason) {
      skillItem.unavailableReason = unavailableReason;
    }
    items.push(skillItem);
  }

  return items;
}
