import { isPathLikeFlashcardStudyId } from '@piwin/contracts';

const PATH_KEYS = new Set(['sourceFile', 'sourceFolder', 'path', 'back']);

export function isHostAbsolutePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return (
    isPathLikeFlashcardStudyId(trimmed) ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    /^[A-Za-z]:/.test(trimmed)
  );
}

export function hostPathBasename(value: string): string {
  const parts = value.split(/[/\\]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? value;
}

function rewriteString(key: string, value: string): string | undefined {
  if (PATH_KEYS.has(key)) return undefined;
  if (!isHostAbsolutePath(value)) return value;
  if (key === 'sourceTitle' || key === 'preview') return hostPathBasename(value);
  return undefined;
}

/** Defense in depth: Host already sanitizes, Mobile still never shows absolute Host paths. */
export function stripHostAbsolutePaths<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, entry: unknown) => {
      if (typeof entry !== 'string') return entry;
      return rewriteString(key, entry);
    }),
  ) as T;
}

export const MOBILE_SOURCE_FULL_OPEN_HINT = '可查看摘录；完整来源需在电脑查看';

export function mobileSourceProjection(input: {
  sourceTitle?: string | undefined;
  sourceExcerpt?: string | undefined;
}): { title?: string; excerpt?: string; hint: string } {
  const rawTitle = input.sourceTitle?.trim();
  const title =
    rawTitle && rawTitle.length > 0
      ? isHostAbsolutePath(rawTitle)
        ? hostPathBasename(rawTitle)
        : rawTitle
      : undefined;
  const excerpt = input.sourceExcerpt?.trim();
  return {
    ...(title ? { title } : {}),
    ...(excerpt && excerpt.length > 0 ? { excerpt } : {}),
    hint: MOBILE_SOURCE_FULL_OPEN_HINT,
  };
}
