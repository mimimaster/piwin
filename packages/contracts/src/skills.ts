/** Skill registry contracts */

export type SkillSource = 'bundled' | 'user' | 'project' | 'mapped';

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  path: string;
  enabled: boolean;
};

export type SkillsConfig = {
  /** Extra skill directories to scan (absolute or ~) */
  extraPaths: string[];
  /** Disabled skill ids */
  disabledIds: string[];
};

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
