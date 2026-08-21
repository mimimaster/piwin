import { MAX_FETCH_OUTLINE_ITEMS } from '@piwin/contracts';

export type ExtractedReadable = {
  title: string | null;
  text: string;
  outline: string[];
};

export async function extractReadableText(
  html: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<ExtractedReadable> {
  const outline = extractOutlineFromHtml(html);
  try {
    if (signal?.aborted) {
      throw new Error('fetch timed out before page parsing');
    }
    const linkedom = await import('linkedom');
    if (signal?.aborted) {
      throw new Error('fetch timed out before page parsing');
    }
    const readability = await import('@mozilla/readability');
    const dom = linkedom.parseHTML(html);
    const document = dom.document;
    const base = document.createElement('base');
    base.setAttribute('href', baseUrl);
    document.head?.appendChild(base);
    const reader = new readability.Readability(document as never);
    const article = reader.parse();
    if (article?.textContent?.trim()) {
      return {
        title: article.title ?? null,
        text: article.textContent.trim(),
        outline,
      };
    }
  } catch {
    // optional deps missing or parse failed
  }
  return {
    title: extractTitleFallback(html),
    text: stripHtml(html),
    outline,
  };
}

export function extractOutlineFromHtml(html: string): string[] {
  const headings: string[] = [];
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match = pattern.exec(html);
  while (match && headings.length < MAX_FETCH_OUTLINE_ITEMS) {
    const text = stripHtml(match[2] ?? '').trim();
    if (text) {
      headings.push(text);
    }
    match = pattern.exec(html);
  }
  return headings;
}

export function extractOutlineFromMarkdown(markdown: string): string[] {
  const headings: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (!match?.[2]) {
      continue;
    }
    const text = match[2].trim();
    if (text) {
      headings.push(text);
    }
    if (headings.length >= MAX_FETCH_OUTLINE_ITEMS) {
      break;
    }
  }
  return headings;
}

export function extractMarkdownTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

export function extractTitleFallback(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || null;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
