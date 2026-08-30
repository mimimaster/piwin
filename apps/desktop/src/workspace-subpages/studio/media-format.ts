export function formatLibraryWhen(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso || '—';
  }
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', weekday: 'short' });
}

export function formatLibraryItemTitle(
  item: {
    name?: string | undefined;
    prompt?: string | undefined;
    assetId: string;
    kind: 'image' | 'video' | 'file';
    createdAt: string;
  },
  locale: string,
): string {
  const name = item.name?.trim();
  if (name) {
    return name;
  }
  const prompt = item.prompt?.trim();
  if (prompt) {
    return prompt.length > 42 ? `${prompt.slice(0, 42)}…` : prompt;
  }
  const when = formatLibraryWhen(item.createdAt, locale);
  const isZh = locale.startsWith('zh');
  if (item.kind === 'image') {
    return isZh ? `图片 · ${when}` : `Image · ${when}`;
  }
  if (item.kind === 'video') {
    return isZh ? `视频 · ${when}` : `Video · ${when}`;
  }
  return isZh ? `文件 · ${when}` : `File · ${when}`;
}

export function formatLibraryType(mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.split('+')[0]?.trim() ?? '';
  if (!subtype) {
    return 'FILE';
  }
  if (subtype === 'jpeg') {
    return 'JPG';
  }
  if (subtype === 'svg+xml') {
    return 'SVG';
  }
  return subtype.toUpperCase();
}

export function formatLibraryBytes(byteSize: number): string {
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    return '—';
  }
  if (byteSize < 1024) {
    return `${byteSize} B`;
  }
  if (byteSize < 1024 * 1024) {
    return `${Math.round(byteSize / 1024)} KB`;
  }
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}
