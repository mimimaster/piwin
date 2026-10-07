/**
 * Shared absolute-timestamp formatting for list rows (archive, branch points).
 * Absolute rather than relative: these rows are used to tell near-identical
 * items apart, where "2 hours ago" on both is worse than a clock reading.
 */

const TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/**
 * `toLocaleString` builds a formatter on every call, and transcript rows ask
 * for the same few stamps on every render. One formatter per locale, and the
 * formatted text per stamp.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();
const formattedStamps = new Map<string, string>();
const MAX_FORMATTED_STAMPS = 2_000;

function formatterFor(locale: 'zh-CN' | 'en-US'): Intl.DateTimeFormat {
  let formatter = formatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, TIMESTAMP_FORMAT);
    formatters.set(locale, formatter);
  }
  return formatter;
}

export function formatTimestamp(isoString: string | undefined, isZh: boolean): string {
  if (!isoString) return '';
  const locale = isZh ? 'zh-CN' : 'en-US';
  const cacheKey = `${locale}|${isoString}`;
  const cached = formattedStamps.get(cacheKey);
  if (cached !== undefined) return cached;
  let formatted: string;
  try {
    const date = new Date(isoString);
    formatted = Number.isNaN(date.getTime()) ? isoString : formatterFor(locale).format(date);
  } catch {
    formatted = isoString;
  }
  if (formattedStamps.size >= MAX_FORMATTED_STAMPS) formattedStamps.clear();
  formattedStamps.set(cacheKey, formatted);
  return formatted;
}
