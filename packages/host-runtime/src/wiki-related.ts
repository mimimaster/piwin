import type { WikiConceptItem, WikiRelatedPage } from '@piwin/contracts';

export function suggestRelatedWikiPages(input: {
  title: string;
  tags: readonly string[];
  concepts: readonly WikiConceptItem[];
  slug: string;
  limit?: number;
}): { related: WikiRelatedPage[]; existingSlug?: string } {
  const limit = input.limit ?? 5;
  const titleNeedle = input.title.trim().toLowerCase();
  const tagSet = new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  const related: WikiRelatedPage[] = [];
  let existingSlug: string | undefined;

  for (const concept of input.concepts) {
    if (concept.slug === input.slug) {
      existingSlug = concept.slug;
      continue;
    }
    const title = concept.title.toLowerCase();
    const titleHit =
      titleNeedle.length > 0 && (title.includes(titleNeedle) || titleNeedle.includes(title));
    const tagHit = concept.tags.some((tag) => tagSet.has(tag.toLowerCase()));
    if (titleHit) {
      related.push({
        slug: concept.slug,
        title: concept.title,
        ...(concept.summary ? { summary: concept.summary } : {}),
        reason: 'title',
      });
    } else if (tagHit) {
      related.push({
        slug: concept.slug,
        title: concept.title,
        ...(concept.summary ? { summary: concept.summary } : {}),
        reason: 'tag',
      });
    }
    if (related.length >= limit) break;
  }

  return { related, ...(existingSlug ? { existingSlug } : {}) };
}
