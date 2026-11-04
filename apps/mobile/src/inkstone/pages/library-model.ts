/**
 * 资料库 display model: public `media/list` items only, formatted for a phone.
 *
 * Nothing here repairs Host data. A malformed item is dropped rather than
 * guessed at, and an unknown error string keeps its original text so the user
 * sees what the Host actually said.
 */
import type { HostResponse, MediaLibraryItem, MediaLibraryKind } from '@piwin/contracts';

/** Grid page size. Two columns, so one page is ~3 phone screens of tiles. */
export const LIBRARY_PAGE_SIZE = 24;

/**
 * While 收藏 has nothing on the loaded pages we pull more, but a phone must not
 * scan an entire vault: stop after this many extra pages and say so.
 */
export const FAVORITE_SCAN_PAGE_LIMIT = 8;

export type LibraryTab = '全部' | '图片' | '视频' | '收藏';
export const LIBRARY_TABS: readonly LibraryTab[] = ['全部', '图片', '视频', '收藏'];

export type LibraryPage = {
  items: MediaLibraryItem[];
  total: number;
  nextCursor?: string;
};

const MEDIA_KINDS: readonly MediaLibraryKind[] = ['image', 'video', 'file'];

/** 收藏 is client-side; the other tabs map straight onto `media/list.kind`. */
export function kindForLibraryTab(tab: LibraryTab): MediaLibraryKind | undefined {
  if (tab === '图片') return 'image';
  if (tab === '视频') return 'video';
  return undefined;
}

export function libraryItemKey(item: Pick<MediaLibraryItem, 'assetId' | 'sessionId'>): string {
  return `${item.sessionId}:${item.assetId}`;
}

/** Cursor pages can overlap when new assets land; keep the first copy of each. */
export function mergeLibraryItems(
  current: readonly MediaLibraryItem[],
  incoming: readonly MediaLibraryItem[],
): MediaLibraryItem[] {
  const seen = new Set(current.map(libraryItemKey));
  const merged = [...current];
  for (const item of incoming) {
    const key = libraryItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export function readLibraryPage(
  response: HostResponse,
): { ok: true; page: LibraryPage } | { ok: false; error: string } {
  if (!response.success) {
    return { ok: false, error: mapLibraryError(response.error) };
  }
  const data = response.data;
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: 'Host 返回的资料库数据无法读取。' };
  }
  const record = data as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items.filter(isLibraryItem) : [];
  const page: LibraryPage = {
    items,
    total:
      typeof record.total === 'number' && Number.isFinite(record.total)
        ? record.total
        : items.length,
  };
  if (typeof record.nextCursor === 'string' && record.nextCursor.length > 0) {
    page.nextCursor = record.nextCursor;
  }
  return { ok: true, page };
}

function isLibraryItem(value: unknown): value is MediaLibraryItem {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.assetId === 'string' &&
    record.assetId.length > 0 &&
    typeof record.sessionId === 'string' &&
    record.sessionId.length > 0 &&
    typeof record.mimeType === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.byteSize === 'number' &&
    Number.isFinite(record.byteSize) &&
    MEDIA_KINDS.includes(record.kind as MediaLibraryKind)
  );
}

/** Original filename, else the prompt that made it, else the vault id. */
export function libraryItemTitle(item: MediaLibraryItem): string {
  const name = item.name?.trim();
  if (name !== undefined && name.length > 0) return name;
  const prompt = item.prompt?.replace(/\s+/gu, ' ').trim();
  if (prompt !== undefined && prompt.length > 0) {
    return prompt.length > 42 ? `${prompt.slice(0, 42)}…` : prompt;
  }
  return item.assetId;
}

export function libraryItemMeta(item: MediaLibraryItem, now: Date = new Date()): string {
  const parts = [formatLibraryDate(item.createdAt, now), formatLibraryBytes(item.byteSize)];
  if (item.kind === 'file') parts.push(item.mimeType);
  return parts.join(' · ');
}

export function formatLibraryDate(value: string, now: Date = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日期未知';
  const elapsed = now.getTime() - date.getTime();
  const day = 86_400_000;
  if (elapsed >= 0 && elapsed < day) return '今天';
  if (elapsed >= day && elapsed < day * 2) return '昨天';
  const month = date.getMonth() + 1;
  const dayOfMonth = date.getDate();
  return date.getFullYear() === now.getFullYear()
    ? `${month}月${dayOfMonth}日`
    : `${date.getFullYear()}年${month}月`;
}

export function formatLibraryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function describeLibraryKind(kind: MediaLibraryKind): string {
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  return '文件';
}

export function emptyLibraryCopy(
  tab: LibraryTab,
  searching: boolean,
): { title: string; detail: string } {
  if (searching) {
    return { title: '没有匹配的素材', detail: '换个关键词，或清空搜索再看。' };
  }
  if (tab === '收藏') {
    return { title: '还没有收藏', detail: '点开任意素材，按右上角的星标收藏。' };
  }
  if (tab === '视频') {
    return { title: '还没有视频', detail: '会话里生成的视频会出现在这里。' };
  }
  if (tab === '图片') {
    return { title: '还没有图片', detail: '在对话里生成或粘贴的图片会存在 Host 资料库。' };
  }
  return { title: '资料库还是空的', detail: '会话中产生的图片、视频和附件都会收在这里。' };
}

/**
 * Host errors reach the phone as strings. Only the few we can act on get
 * rewritten; anything else stays verbatim so nothing is hidden.
 */
export function mapLibraryError(error: string): string {
  if (error === 'Unhandled command') {
    return 'Host 仍是旧进程，没有资料库接口。重启 Host 后重试。';
  }
  if (error.startsWith('Remote command payload was rejected')) {
    return '当前 Host 不支持资料库读取（media/list）。更新 Host 后重新连接。';
  }
  if (error === 'Host transport is not open' || error === 'Host 尚未连接。') {
    return '与 Host 的连接已断开，连上后会自动重新读取。';
  }
  return error;
}
