import { writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Sidecar written by ensure-bundled so installed copies keep product origin. */
export const BUNDLED_SKILL_MARKER = '.piwin-bundled';

export async function writeBundledSkillMarker(skillDir: string): Promise<void> {
  await writeFile(join(skillDir, BUNDLED_SKILL_MARKER), 'bundled\n', 'utf8');
}

export async function hasBundledSkillMarker(skillDir: string): Promise<boolean> {
  try {
    return (await stat(join(skillDir, BUNDLED_SKILL_MARKER))).isFile();
  } catch {
    return false;
  }
}

export function frontmatterHasBundledOrigin(frontmatter: Record<string, string>): boolean {
  return (frontmatter.origin ?? '').trim().toLowerCase() === 'bundled';
}
