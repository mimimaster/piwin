/** Skill registry contracts */

/**
 * Where a skill comes from — not a privilege level.
 * `bundled` is first-party and lives in the product tree (repo `skills/` or
 * the packaged `$PIWIN_BUNDLED_ASSETS_ROOT/skills` copy). It is not copied
 * into `~/.piwin/skills`. `user` is only something the operator installed.
 */
export type SkillSource = 'bundled' | 'user' | 'project' | 'mapped' | 'pi-native';

export const SKILL_SOURCE_DISPLAY_ORDER: readonly SkillSource[] = [
  'bundled',
  'user',
  'project',
  'mapped',
  'pi-native',
];

export type SkillSourceLocale = 'zh-CN' | 'en';

export function resourceSourceLabel(source: SkillSource, locale: SkillSourceLocale): string {
  if (locale === 'zh-CN') {
    switch (source) {
      case 'bundled':
        return '应用内置';
      case 'user':
        return '我安装的';
      case 'project':
        return '项目';
      case 'mapped':
        return '映射';
      case 'pi-native':
        return 'Pi';
    }
  }
  switch (source) {
    case 'bundled':
      return 'bundled';
    case 'user':
      return 'Installed';
    case 'project':
      return 'Project';
    case 'mapped':
      return 'Mapped';
    case 'pi-native':
      return 'Pi';
  }
}

export const skillSourceLabel = resourceSourceLabel;

/** Only operator-installed skills may be removed from disk. */
export function canUninstallSkill(source: SkillSource): boolean {
  return source === 'user';
}

/** Bundled skills stay on; only non-bundled skills may be toggled. */
export function canToggleSkill(source: SkillSource): boolean {
  return source !== 'bundled';
}

export function groupSkillsBySource<T extends { source: SkillSource }>(
  skills: readonly T[],
): Array<{ source: SkillSource; skills: T[] }> {
  const buckets = new Map<SkillSource, T[]>();
  for (const source of SKILL_SOURCE_DISPLAY_ORDER) {
    buckets.set(source, []);
  }
  for (const skill of skills) {
    const bucket = buckets.get(skill.source);
    if (bucket) {
      bucket.push(skill);
    }
  }
  return SKILL_SOURCE_DISPLAY_ORDER
    .map((source) => ({ source, skills: buckets.get(source) ?? [] }))
    .filter((group) => group.skills.length > 0);
}

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

/**
 * Product slash names that are never an installed Skill. Used to recover
 * explicit skill intent from stored `/name` text when `PromptInput.skillId`
 * was omitted (edit/resend / older rows).
 */
const NON_SKILL_SLASH_NAMES: ReadonlySet<string> = new Set([
  'compact',
  'summarize',
  'compress',
  'ultra-code',
  'fusion',
  'scheme',
  'knowledge',
  'doccards',
  'flashcards',
  'cards',
  'notes',
  'wiki',
  'agent',
  'goal',
]);

export type ExplicitSkillIntent = {
  skillId: string;
  userRequest: string;
};

/**
 * Read explicit skill intent from harness encodings — the Host wrapper or a
 * leading `/skill` token. This is not inference from model output.
 */
export function readExplicitSkillIntent(text: string): ExplicitSkillIntent | null {
  const trimmed = text.trim();
  const wrapper = /^\[piwin-skill:([^\]]+)\]/.exec(trimmed);
  const wrapperId = wrapper?.[1]?.trim();
  if (wrapperId) {
    const extracted = extractSkillUserRequest(trimmed);
    const userRequest =
      extracted === null || extracted === '(no additional user request)' ? '' : extracted;
    return { skillId: wrapperId, userRequest };
  }
  if (!trimmed.startsWith('/')) {
    return null;
  }
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  const name = match?.[1]?.toLowerCase();
  if (!name || NON_SKILL_SLASH_NAMES.has(name)) {
    return null;
  }
  return { skillId: name, userRequest: (match?.[2] ?? '').trim() };
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
    }
  | {
      /**
       * Host-absolute file resolved by the Host for a local shell (ADR 0052 §6).
       * The Host keeps the path; a remote projection refuses this variant, so it
       * never carries host filesystem layout across a network boundary.
       */
      kind: 'local-file';
      absolutePath: string;
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
