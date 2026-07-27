/** CE-HUB-SK: skill store listing from static catalog (git-index later). */
import type { SkillStoreEntry } from '@piwin/contracts';
import { RECOMMENDED_SKILLS } from './catalog.js';

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
