/**
 * Finds the one skill folder to install inside a cloned repository. Skill
 * repos are often collections (`skills/<name>/SKILL.md`), and community index
 * results only name the skill, not its path — so the installer matches the
 * requested name against folder names and SKILL.md `name:` fields.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { parseSkillFrontmatter } from '@piwin/contracts';

/** Deep enough for `plugins/<p>/skills/<name>/SKILL.md`, shallow enough to stay fast. */
const MAX_SEARCH_DEPTH = 4;
const MAX_LISTED_CANDIDATES = 10;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git']);

type SkillCandidate = { directory: string; frontmatterName: string | undefined };

async function isFile(pathValue: string): Promise<boolean> {
  try {
    return (await stat(pathValue)).isFile();
  } catch {
    // Missing or unreadable path is simply "not a skill file".
    return false;
  }
}

async function readFrontmatterName(skillFile: string): Promise<string | undefined> {
  try {
    const name = parseSkillFrontmatter(await readFile(skillFile, 'utf8')).name?.trim();
    return name ? name : undefined;
  } catch {
    // An unreadable SKILL.md still counts as a candidate, matched by folder name only.
    return undefined;
  }
}

async function collectCandidates(
  directory: string,
  depth: number,
  into: SkillCandidate[],
): Promise<void> {
  const skillFile = join(directory, 'SKILL.md');
  if (await isFile(skillFile)) {
    into.push({ directory, frontmatterName: await readFrontmatterName(skillFile) });
    // A skill folder's own subfolders are its resources, not more skills.
    return;
  }
  if (depth >= MAX_SEARCH_DEPTH) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    // Unreadable subtree: skip it rather than fail the whole install.
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    await collectCandidates(join(directory, entry.name), depth + 1, into);
  }
}

function matchesName(candidate: SkillCandidate, wanted: string): boolean {
  const target = wanted.toLowerCase();
  return (
    basename(candidate.directory).toLowerCase() === target ||
    candidate.frontmatterName?.toLowerCase() === target
  );
}

/**
 * Returns the directory holding the skill's SKILL.md. `root` itself wins when
 * it is a skill; otherwise a single match on `skillName`, else the only skill
 * in the tree. Throws with the available skill paths when the choice is ambiguous.
 */
export async function locateSkillDirectory(root: string, skillName?: string): Promise<string> {
  if (await isFile(join(root, 'SKILL.md'))) return root;
  const candidates: SkillCandidate[] = [];
  await collectCandidates(root, 0, candidates);
  if (candidates.length === 0) {
    throw new Error(`No SKILL.md found under ${root}`);
  }
  const wanted = skillName?.trim();
  if (wanted) {
    const matches = candidates.filter((candidate) => matchesName(candidate, wanted));
    if (matches.length === 1 && matches[0]) return matches[0].directory;
    if (matches.length > 1) {
      // Prefer an exact folder-name match over a frontmatter-only match.
      const byFolder = matches.filter(
        (candidate) => basename(candidate.directory).toLowerCase() === wanted.toLowerCase(),
      );
      if (byFolder.length === 1 && byFolder[0]) return byFolder[0].directory;
    }
  }
  // With one skill in the tree, `skillName` may just be a rename (`--name alias`).
  if (candidates.length === 1 && candidates[0]) return candidates[0].directory;
  const listed = candidates
    .slice(0, MAX_LISTED_CANDIDATES)
    .map((candidate) => relative(root, candidate.directory))
    .join(', ');
  const more = candidates.length > MAX_LISTED_CANDIDATES ? ', …' : '';
  throw new Error(
    wanted
      ? `Skill "${wanted}" not found in repository; available: ${listed}${more}`
      : `Repository holds several skills; pick one by name: ${listed}${more}`,
  );
}
