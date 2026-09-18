/**
 * Parse a filesystem path the model used to `read` a Skill document.
 *
 * Packaged Hosts list bundled skills under
 * `.../bundled-assets/skills/<id>/SKILL.md`. Models often reuse that prefix
 * for project-local skills that actually live in `.agents/skills` or
 * `.pi/skills`. Callers remap the guessed path via the skill catalog.
 */
import { normalizeResourceId } from './resource.js';

function tryNormalizeResourceId(value: string): string | null {
  try {
    return normalizeResourceId(value);
  } catch {
    return null;
  }
}

/**
 * Extract a skill id from common layouts:
 * - `.../skills/<id>/SKILL.md`
 * - `.../skills/<id>.md`
 * - `.../skills/<id>/`
 * - `.../<id>/SKILL.md`
 */
export function extractSkillIdFromDocumentPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/^file:\/\//i, '');
  const skillMarkdown = normalized.match(/\/skills\/([^/]+)\/SKILL\.md$/i);
  if (skillMarkdown?.[1]) {
    return tryNormalizeResourceId(skillMarkdown[1]);
  }
  const skillDirectory = normalized.match(/\/skills\/([^/]+)\/?$/i);
  if (skillDirectory?.[1] && !skillDirectory[1].includes('.')) {
    return tryNormalizeResourceId(skillDirectory[1]);
  }
  const skillFile = normalized.match(/\/skills\/([^/]+)\.md$/i);
  if (skillFile?.[1]) {
    return tryNormalizeResourceId(skillFile[1]);
  }
  if (/\/SKILL\.md$/i.test(normalized)) {
    const parts = normalized.split('/').filter(Boolean);
    const parent = parts.length >= 2 ? parts[parts.length - 2] : null;
    if (parent && parent !== 'skills') {
      return tryNormalizeResourceId(parent);
    }
  }
  return null;
}

/** Join a catalog skill path (directory or markdown file) to SKILL.md. */
export function skillMarkdownPathFromCatalogPath(skillPath: string): string {
  const normalized = skillPath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (/\.md$/i.test(normalized)) {
    return skillPath;
  }
  const separator = skillPath.includes('\\') && !skillPath.includes('/') ? '\\' : '/';
  return `${normalized}${separator}SKILL.md`;
}

export type SkillDocumentCatalogEntry = {
  resourceId?: string;
  id?: string;
  path: string;
};

/**
 * Catalog SKILL.md for a guessed read path, or null when this is not a skill
 * document path / the id is not in the catalog.
 */
export function catalogSkillMarkdownPathForRead(input: {
  requestedPath: string;
  skills: readonly SkillDocumentCatalogEntry[];
}): string | null {
  const skillId = extractSkillIdFromDocumentPath(input.requestedPath);
  if (!skillId) {
    return null;
  }
  const matched = input.skills.find((skill) => {
    const rawId = skill.resourceId ?? skill.id;
    if (!rawId) {
      return false;
    }
    return tryNormalizeResourceId(rawId) === skillId;
  });
  if (!matched) {
    return null;
  }
  return skillMarkdownPathFromCatalogPath(matched.path);
}
