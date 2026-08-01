export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('localhost') || /^\d{1,3}(\.\d{1,3}){3}/.test(trimmed)) {
    return `http://${trimmed}`;
  }
  if (/^\d+$/.test(trimmed)) {
    return `http://localhost:${trimmed}`;
  }
  return `https://${trimmed}`;
}