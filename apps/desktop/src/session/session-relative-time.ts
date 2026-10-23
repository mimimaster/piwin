/** Compact relative timestamp shared by session navigation surfaces. */
export function formatSessionRelativeTime(dateString?: string): string {
  if (!dateString) return '';
  const timestamp = new Date(dateString).getTime();
  const differenceMs = Date.now() - timestamp;
  if (!Number.isFinite(timestamp) || differenceMs < 0) return '';

  const seconds = Math.floor(differenceMs / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}
