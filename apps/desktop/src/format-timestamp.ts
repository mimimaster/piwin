/**
 * Shared absolute-timestamp formatting for list rows (archive, branch points).
 * Absolute rather than relative: these rows are used to tell near-identical
 * items apart, where "2 hours ago" on both is worse than a clock reading.
 */

export function formatTimestamp(isoString: string | undefined, isZh: boolean): string {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleString(isZh ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}
