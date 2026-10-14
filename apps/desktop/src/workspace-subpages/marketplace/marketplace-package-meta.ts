/**
 * Pure helpers for live-search hits: labels, stable test ids, catalog
 * de-duplication, ordering, and README sanitizing. No I/O.
 */
import type { MarketplaceCatalogEntry, MarketplaceSearchHit } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import type { CommunitySort } from './marketplace-types.js';

export function packageSourceLabel(hit: Pick<MarketplaceSearchHit, 'source'>): string {
  switch (hit.source) {
    case 'github':
      return 'GitHub';
    case 'mcp-registry':
      return 'MCP Registry';
    case 'skill':
      return 'Skill';
    case 'npm-pi-package':
      return 'npm';
    default:
      // A newer Host may add sources; show its raw id rather than nothing.
      return String(hit.source);
  }
}

export function packageTestId(hit: Pick<MarketplaceSearchHit, 'source' | 'entryId' | 'name'>): string {
  const slug = (hit.source === 'github' ? hit.entryId.replace(/^github:/, '') : hit.name).replace(/[@/]/g, '-');
  const prefix =
    hit.source === 'github' ? 'github' : hit.source === 'mcp-registry' ? 'mcp' : hit.source === 'skill' ? 'skill' : 'npm';
  return `market-${prefix}-${slug}`;
}

/** Page a human can open to review the source before installing. */
export function packageSourceUrl(hit: MarketplaceSearchHit): string | undefined {
  switch (hit.source) {
    case 'github':
    case 'skill':
      return hit.repositoryUrl;
    case 'mcp-registry':
      return hit.homepage;
    case 'npm-pi-package':
      return hit.npmUrl ?? hit.repositoryUrl;
    default:
      return hit.repositoryUrl ?? hit.homepage;
  }
}

function repoKey(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/**
 * Identity keys of curated entries, so a community result for the same
 * package is not shown twice (once reviewed, once "unreviewed").
 */
export function catalogPackageKeys(entries: readonly MarketplaceCatalogEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    const install = entry.install;
    if (install.kind === 'pi-package') {
      if (install.source.kind === 'npm') keys.add(`npm:${install.source.packageName.toLowerCase()}`);
      if (install.source.kind === 'git') {
        const key = repoKey(install.source.repositoryUrl);
        if (key) keys.add(`repo:${key}`);
      }
    }
    const homepage = repoKey(entry.homepage);
    if (homepage?.includes('github.com/')) keys.add(`repo:${homepage}`);
  }
  return keys;
}

export function isCatalogDuplicate(hit: MarketplaceSearchHit, keys: ReadonlySet<string>): boolean {
  if (hit.source === 'npm-pi-package' && keys.has(`npm:${hit.name.toLowerCase()}`)) return true;
  const repo = repoKey(hit.repositoryUrl);
  return repo !== undefined && keys.has(`repo:${repo}`);
}

/** `recent` puts the latest publish/push first; hits without a date sink, source order kept. */
export function sortCommunityHits(
  hits: readonly MarketplaceSearchHit[],
  sort: CommunitySort,
): MarketplaceSearchHit[] {
  if (sort === 'popular') return [...hits];
  const time = (hit: MarketplaceSearchHit) => {
    const value = hit.updatedAt ? Date.parse(hit.updatedAt) : Number.NaN;
    return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  };
  return hits
    .map((hit, index) => ({ hit, index }))
    .sort((left, right) => time(right.hit) - time(left.hit) || left.index - right.index)
    .map(({ hit }) => hit);
}

const DAY_MS = 86_400_000;

/** "3 days ago" / "3 天前"; older than a year shows the date. */
export function formatRelativeDate(
  iso: string,
  locale: DesktopLocale | undefined,
  now: number = Date.now(),
): string | undefined {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return undefined;
  const days = Math.max(0, Math.floor((now - time) / DAY_MS));
  if (days > 365) return new Date(time).toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en');
  const format = new Intl.RelativeTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en', { numeric: 'auto' });
  if (days >= 30) return format.format(-Math.floor(days / 30), 'month');
  return format.format(-days, 'day');
}

const IMG_TAG = /<img\b[^>]*>/gi;
const IMG_ALT = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/** Prose outside code fences: images become alt text, other HTML tags drop. */
function sanitizeProse(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(IMG_TAG, (tag) => {
      const alt = IMG_ALT.exec(tag);
      return alt?.[1] ?? alt?.[2] ?? '';
    })
    .replace(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g, '')
    .replace(/\[!\[([^\]]*)\]\([^)]*\)\]\([^)]*\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, (line) => (/\.(png|jpe?g|gif|svg|webp)(\?|$|\s)/i.test(line) ? '' : line));
}

/**
 * README text is third-party markdown. The renderer escapes raw HTML, which
 * would show tags as text; here images (markdown or HTML) become their alt
 * text and other tags are dropped so opening a detail never fetches from
 * hosts the user has not chosen to visit. Fenced code is left untouched.
 */
export function sanitizeReadme(markdown: string): string {
  return markdown
    .split(/(^```[\s\S]*?^```[^\n]*$)/m)
    .map((part, index) => (index % 2 === 1 ? part : sanitizeProse(part)))
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
