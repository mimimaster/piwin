/** Convert a wiki target / title into a concept slug. */
export function slugifyWikiTarget(target: string): string {
  return target
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** Convert [[Target|Alias]] or [[Target]] to markdown link [Alias](#concept-slug) */
export function formatWikilinksForMarkdown(content: string): string {
  return content.replace(/\[\[([^\[\]]+)\]\]/g, (_match, inner: string) => {
    const parts = inner.split('|');
    const target = parts[0]?.trim() ?? '';
    const alias = parts[1]?.trim() || target;
    return `[${alias}](#concept-${slugifyWikiTarget(target)})`;
  });
}

/** Resolve a stored wiki link (slug or title) to a human label. */
export function wikiLinkLabel(
  link: string,
  concepts: ReadonlyArray<{ slug: string; title: string }>,
): string {
  const slug = slugifyWikiTarget(link);
  const match = concepts.find(
    (concept) => concept.slug === link || concept.slug === slug || concept.title === link,
  );
  return match?.title ?? link;
}
