/**
 * Detail for a skill hit: the skill's own SKILL.md rather than its
 * repository README, which for a multi-skill collection describes the whole
 * collection. Read-only; the text is untrusted markdown.
 */
import { parseSkillFrontmatter } from '@piwin/contracts';

/** `skills/<name>/SKILL.md`, `plugins/<p>/skills/<name>/SKILL.md`: same bound the installer searches. */
const MAX_PATH_SEGMENTS = 5;
const SAFE_REF = /^[A-Za-z0-9._/-]+$/;

export type SkillDetailTarget = { name: string; subdir?: string; ref?: string };

/** Fetches text or JSON over GitHub with the caller's timeout/auth policy. */
export type GithubTextFetcher = (url: string, accept: string) => Promise<string>;

export type SkillDetail = { readme?: string; description?: string };

function isSkippedSegment(segment: string): boolean {
  return segment.startsWith('.') || segment === 'node_modules';
}

/** Picks `<…>/<name>/SKILL.md` from a recursive tree listing; the only SKILL.md otherwise. */
export function pickSkillMarkdownPath(paths: readonly string[], skillName: string): string | undefined {
  const candidates = paths.filter((path) => {
    const segments = path.split('/');
    return (
      segments.at(-1) === 'SKILL.md' &&
      segments.length <= MAX_PATH_SEGMENTS &&
      !segments.slice(0, -1).some(isSkippedSegment)
    );
  });
  const wanted = skillName.toLowerCase();
  const byFolder = candidates.filter((path) => path.split('/').at(-2)?.toLowerCase() === wanted);
  if (byFolder.length === 1) return byFolder[0];
  return candidates.length === 1 ? candidates[0] : undefined;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

async function resolveSkillPath(
  ownerRepo: string,
  target: SkillDetailTarget,
  ref: string,
  fetchText: GithubTextFetcher,
): Promise<string | undefined> {
  if (target.subdir) return `${target.subdir.replace(/^\/+|\/+$/g, '')}/SKILL.md`;
  const listing = JSON.parse(
    await fetchText(
      `https://api.github.com/repos/${ownerRepo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      'application/vnd.github+json',
    ),
  ) as { tree?: Array<{ path?: unknown; type?: unknown }> };
  const paths = (listing.tree ?? []).flatMap((item) =>
    item.type === 'blob' && typeof item.path === 'string' ? [item.path] : [],
  );
  return pickSkillMarkdownPath(paths, target.name);
}

/**
 * SKILL.md body and `description` for one skill in `ownerRepo`. Returns an
 * empty detail when the skill folder cannot be identified, so the caller can
 * fall back to the repository README.
 */
export async function readSkillDetail(
  ownerRepo: string,
  target: SkillDetailTarget,
  fetchText: GithubTextFetcher,
): Promise<SkillDetail> {
  const ref = target.ref && SAFE_REF.test(target.ref) ? target.ref : 'HEAD';
  const path = await resolveSkillPath(ownerRepo, target, ref, fetchText);
  if (!path || path.split('/').some((segment) => segment === '..')) return {};
  const markdown = await fetchText(
    `https://raw.githubusercontent.com/${ownerRepo}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`,
    'text/plain',
  );
  const description = parseSkillFrontmatter(markdown).description?.trim();
  const body = stripFrontmatter(markdown);
  return {
    ...(body ? { readme: body } : {}),
    ...(description ? { description } : {}),
  };
}
