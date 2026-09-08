/** Skill registry contracts */

export type SkillSource = 'bundled' | 'user' | 'project' | 'mapped' | 'pi-native';

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  enabled: boolean;
  hidden?: boolean;
  };
export type SkillsConfig = {
  /** Extra skill directories to scan (absolute or ~) */
  extraPaths: string[];
  /** Disabled skill ids */
  disabledIds: string[];
};

export type FormatSkillPromptOptions = {
  /**
   * Full SKILL.md instructions for an explicit activation (slash / mention).
   * When set, the Host injects Tier-2 skill body per Agent Skills progressive
   * disclosure — not metadata-only "follow this skill" text.
   */
  skillBody?: string;
};

/** Canonical model-facing wrapper for an explicitly selected installed Skill. */
export function formatSkillPrompt(
  skillName: string,
  skillId: string,
  request: string,
  options?: FormatSkillPromptOptions,
): string {
  const userRequest = request.trim() || '(no additional user request)';
  const skillBody = options?.skillBody?.trim();
  if (skillBody) {
    return [
      `[piwin-skill:${skillName}]`,
      `Follow the installed skill "${skillName}" (id: ${skillId}).`,
      '',
      '## Skill instructions',
      skillBody,
      '',
      '## User request',
      userRequest,
    ].join('\n');
  }
  return [
    `[piwin-skill:${skillName}]`,
    `Follow the installed skill "${skillName}" (id: ${skillId}). Apply its workflow to the user request below.`,
    '---',
    userRequest,
  ].join('\n');
}

/**
 * Recover the user request portion from a `formatSkillPrompt` wrapper.
 * Returns null when `text` is not a recognized skill wrapper.
 */
export function extractSkillUserRequest(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[piwin-skill:')) {
    return null;
  }
  const richMarker = '\n## User request\n';
  const richIndex = trimmed.indexOf(richMarker);
  if (richIndex !== -1) {
    return trimmed.slice(richIndex + richMarker.length).trim() || '(no additional user request)';
  }
  const thinMarker = '\n---\n';
  const thinIndex = trimmed.indexOf(thinMarker);
  if (thinIndex !== -1) {
    return trimmed.slice(thinIndex + thinMarker.length).trim() || '(no additional user request)';
  }
  return null;
}

/** Strip YAML frontmatter so model-facing activation carries instructions only. */
export function stripSkillMarkdownFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) {
    return markdown.trim();
  }
  return markdown.slice(match[0].length).trim();
}

/** Well-known third-party skill roots users can map into config.skills.extraPaths. */
export type WellKnownSkillPathPreset = {
  id: string;
  label: string;
  /** Path with ~ for home; host expands. */
  path: string;
};

export const WELL_KNOWN_SKILL_PATH_PRESETS: WellKnownSkillPathPreset[] = [
  { id: 'cursor', label: 'Cursor skills', path: '~/.cursor/skills' },
  { id: 'claude', label: 'Claude skills', path: '~/.claude/skills' },
  { id: 'codex', label: 'Codex skills', path: '~/.codex/skills' },
  { id: 'agents', label: 'Agents skills (user)', path: '~/.agents/skills' },
];

/** Logical document target for tool cards / Doc Preview (resource identity). */
export type DocumentTargetRef =
  | {
      kind: 'project-file';
      relativePath: string;
      displayRef: string;
    }
  | {
      kind: 'skill';
      skillId: string;
      displayRef: string;
      effectiveSource?: SkillSource;
    }
  | {
      /** Session media vault asset — logical id only, never a host path. */
      kind: 'media';
      sessionId: string;
      assetId: string;
      displayRef: string;
    }
  | {
      /** Config-root text under `~/.piwin/**` — relative path only, never a host path. */
      kind: 'trusted-config';
      relativePath: string;
      displayRef: string;
    };

/** Stable failure reasons for skills/read (UI maps to copy; do not parse free text). */
export type SkillPreviewFailureReason =
  | 'not-found'
  | 'outside-catalog'
  | 'not-a-file'
  | 'binary'
  | 'too-large'
  | 'skill-unresolved'
  | 'snapshot-unavailable'
  | 'invalid-request';

export type SkillResourceOrigin =
  | 'bundled-installed'
  | 'user-installed'
  | 'project'
  | 'mapped'
  | 'pi-native'
  | 'unknown';

export type SkillsReadData =
  | {
      status: 'ready';
      skillId: string;
      name: string;
      effectiveSource: SkillSource;
      origin: SkillResourceOrigin;
      displayRef: string;
      content: string;
      byteSize: number;
      truncated: boolean;
      provenance: 'current-resource';
    }
  | {
      status: 'unavailable';
      reason: SkillPreviewFailureReason;
      skillId?: string;
      displayRef: string;
      suggestion?: string;
    };
