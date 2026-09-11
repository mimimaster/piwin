/**
 * Build slash catalog from static commands, agent modes, and skills list.
 */
import type { SkillSource } from '@piwin/contracts';
import { AGENT_MODES, type AgentModeId } from '../agent-mode';
import type { SlashItem } from './slash-types';

export type SlashSkillInput = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** When set, Conversation slash hides project-local skills (ADR 0016). */
  source?: SkillSource;
};

/** Sources allowed in Conversation slash (not project-local). */
export function isConversationSlashSkillSource(source: SkillSource | undefined): boolean {
  if (source === undefined) {
    // Legacy callers without source keep listing (tests / older menus).
    return true;
  }
  return source !== 'project';
}

export type BuildSlashCatalogOptions = {
  skills: SlashSkillInput[];
  /** Host capabilities.compaction when known; default true for mock/sdk. */
  compactionSupported?: boolean;
  streaming?: boolean;
  compacting?: boolean;
  hasActiveSession?: boolean;
  projectTrusted?: boolean;
  /** When false, skip the project-trust gate (General sessions). Default true. */
  requireProjectTrust?: boolean;
  /** Current agent mode (for availability UI only). */
  agentMode?: AgentModeId;
  /** Whether the goal extension is enabled (defaults to true). */
  goalExtensionEnabled?: boolean;
  /** Conversation chat hides orchestration commands. Skills stay slash-callable. */
  conversationChat?: boolean;
};

/**
 * Reserved command names win over skills with the same token.
 */
export const RESERVED_SLASH_COMMAND_NAMES: ReadonlySet<string> = new Set([
  'compact',
  'summarize',
  'compress',
  'agent',
  'goal',
  // Retired composer modes — keep reserved so a skill cannot claim the tokens.
  'plan',
  'ask',
  'scheme',
  'ultra-code',
  'knowledge',
  'kb',
  'doccards',
  'flashcards',
  'cards',
  'notes',
  'wiki',
]);

/**
 * Skill alias map: alias slash name → canonical skill id. Aliases appear in
 * the autocomplete menu attached to the canonical skill item and resolve in
 * parseComposerSlashSubmit. Keep one canonical skill asset per alias.
 */
export const SKILL_SLASH_ALIASES: Record<string, string> = {
  'write-plan': 'writing-plans',
  'optimize-prompts': 'optimize-prompt',
  'prompt-optimize': 'optimize-prompt',
};

export function buildSlashCatalog(options: BuildSlashCatalogOptions): SlashItem[] {
  const compactionSupported = options.compactionSupported !== false;
  const streaming = options.streaming === true;
  const compacting = options.compacting === true;
  const hasActiveSession = options.hasActiveSession === true;
  const projectTrusted = options.projectTrusted === true;
  const requireProjectTrust = options.requireProjectTrust !== false;
  const interactive = hasActiveSession && (!requireProjectTrust || projectTrusted);
  // Skills are callable in drafts once the project is trusted: they only need
  // trust, not an active session (draft submit resolves the session).
  const skillsReady = projectTrusted || !requireProjectTrust;
  const conversationChat = options.conversationChat === true;

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

  // --- Flashcards home + knowledge bases (legacy tokens stay aliases) ---
  if (!conversationChat) {
    items.push({
      id: 'cmd:flashcards',
      kind: 'command',
      name: 'flashcards',
      aliases: ['cards', 'doccards'],
      label: 'Flashcards',
      description: 'Open flashcards / 打开闪卡',
      keywords: ['flashcards', 'cards', 'doccards', 'fsrs', 'review', 'anki', '闪卡', '卡片', '复习'],
      groupLabel: 'Command',
      available: true,
    });
    items.push({
      id: 'cmd:knowledge',
      kind: 'command',
      name: 'knowledge',
      aliases: ['kb', 'notes', 'wiki'],
      label: 'Knowledge',
      description: 'Open knowledge bases / 打开知识库',
      keywords: ['knowledge', 'kb', 'rag', 'notes', 'wiki', 'search', '知识库', '笔记', '检索'],
      groupLabel: 'Command',
      available: true,
    });
  }

  // --- Orchestration scheme (per-send opt-in) ---
  if (!conversationChat) {
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
  // The slash menu is the only mode entry point in either session kind: there
  // is no toolbar picker, so `/goal` has to be discoverable here.
  for (const mode of AGENT_MODES) {
    const isGoalDisabled = mode.id === 'goal' && options.goalExtensionEnabled === false;
    items.push({
      id: `mode:${mode.id}`,
      kind: 'mode',
      name: mode.id,
      label: mode.label,
      description: mode.description,
      keywords: [mode.title, mode.id],
      groupLabel: 'Mode',
      available: !isGoalDisabled,
      ...(isGoalDisabled
        ? { unavailableReason: 'Enable the Goal extension in Settings → Extensions' }
        : {}),
    });
  }

  // --- Skills (skip names reserved by commands/modes) ---
  for (const skill of options.skills) {
    // Conversation: explicit /skill is Host-injected for user-level skills only.
    // Project-local skills stay out of the menu (ADR 0016).
    if (conversationChat && !isConversationSlashSkillSource(skill.source)) {
      continue;
    }
    const token = skill.name.trim() || skill.id;
    const lower = token.toLowerCase();
    if (RESERVED_SLASH_COMMAND_NAMES.has(lower)) {
      continue;
    }
    const enabled = skill.enabled !== false;
    const available = enabled && skillsReady;
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
      ...(!available
        ? {
            unavailableReason: !enabled
              ? 'Enable this skill in Settings → Skills'
              : 'Trust the project first',
          }
        : {}),
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
    items.push(skillItem);
  }

  return items;
}
