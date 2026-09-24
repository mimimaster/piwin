/** Skill store listing, projected from the curated marketplace catalog. */
import type { InstallSource, SkillStoreEntry } from '@piwin/contracts';
import { SKILL_CATALOG } from './catalog/skills.js';

export type RecommendedSkill = {
  id: string;
  name: string;
  description: string;
  source: Extract<InstallSource, { kind: 'git' }>;
};

/** Legacy shape kept for `piwin skill recommended` and `skills/store-list`. */
export const RECOMMENDED_SKILLS: RecommendedSkill[] = SKILL_CATALOG.flatMap((entry) =>
  entry.install.kind === 'skill' && entry.install.source.kind === 'git'
    ? [
        {
          id: entry.capabilityId,
          name: entry.capabilityId,
          description: entry.summary.en,
          source: entry.install.source,
        },
      ]
    : [],
);

export function listSkillStoreEntries(query?: string): SkillStoreEntry[] {
  const entries: SkillStoreEntry[] = RECOMMENDED_SKILLS.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    source: item.source,
  }));
  const q = query?.trim().toLowerCase() ?? '';
  if (!q) return entries;
  return entries.filter(
    (entry) =>
      entry.id.toLowerCase().includes(q) ||
      entry.name.toLowerCase().includes(q) ||
      entry.description.toLowerCase().includes(q),
  );
}
