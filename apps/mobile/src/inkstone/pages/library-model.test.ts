// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { HostResponse, MediaLibraryItem } from '@piwin/contracts';
import {
  emptyLibraryCopy,
  formatLibraryBytes,
  formatLibraryDate,
  kindForLibraryTab,
  libraryItemKey,
  libraryItemMeta,
  libraryItemTitle,
  mapLibraryError,
  mergeLibraryItems,
  readLibraryPage,
} from './library-model.js';

function item(overrides: Partial<MediaLibraryItem> = {}): MediaLibraryItem {
  return {
    assetId: 'a1',
    sessionId: 's1',
    mimeType: 'image/webp',
    byteSize: 2048,
    createdAt: '2026-11-02T09:00:00.000Z',
    kind: 'image',
    ...overrides,
  };
}

function ok(data: unknown): HostResponse {
  return { type: 'response', command: 'media/list', success: true, data };
}

describe('资料库 model', () => {
  it('maps tabs onto the Host kind filter except 收藏, which is device-local', () => {
    expect(kindForLibraryTab('全部')).toBeUndefined();
    expect(kindForLibraryTab('图片')).toBe('image');
    expect(kindForLibraryTab('视频')).toBe('video');
    expect(kindForLibraryTab('收藏')).toBeUndefined();
  });

  it('keeps well-formed items, drops malformed ones, and reports Host totals', () => {
    const parsed = readLibraryPage(
      ok({
        items: [item(), { assetId: 'x' }, null, item({ assetId: 'a2', kind: 'video' })],
        total: 12,
        nextCursor: 'cursor-2',
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.items.map((entry) => entry.assetId)).toEqual(['a1', 'a2']);
    expect(parsed.page.total).toBe(12);
    expect(parsed.page.nextCursor).toBe('cursor-2');
  });

  it('falls back to the page length when the Host omits a total', () => {
    const parsed = readLibraryPage(ok({ items: [item()] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.total).toBe(1);
    expect(parsed.page.nextCursor).toBeUndefined();
  });

  it('rewrites only the actionable Host errors and keeps the rest verbatim', () => {
    expect(mapLibraryError('Unhandled command')).toContain('重启 Host');
    expect(mapLibraryError('Remote command payload was rejected: media/list')).toContain('media/list');
    expect(mapLibraryError('Host transport is not open')).toContain('连接已断开');
    expect(mapLibraryError('boom from host')).toBe('boom from host');
    const failed: HostResponse = { type: 'response', command: 'media/list', success: false, error: 'Host transport is not open' };
    expect(readLibraryPage(failed)).toEqual({ ok: false, error: expect.stringContaining('连接已断开') });
  });

  it('dedupes cursor overlaps so a repeated asset never renders twice', () => {
    const merged = mergeLibraryItems([item(), item({ assetId: 'a2' })], [item({ assetId: 'a2' }), item({ assetId: 'a3' })]);
    expect(merged.map((entry) => entry.assetId)).toEqual(['a1', 'a2', 'a3']);
    expect(libraryItemKey(merged[0] as MediaLibraryItem)).toBe('s1:a1');
  });

  it('titles an asset by filename, then prompt, then vault id', () => {
    expect(libraryItemTitle(item({ name: '  paper-shell.webp ' }))).toBe('paper-shell.webp');
    expect(libraryItemTitle(item({ prompt: '  墨色\n渐变  ' }))).toBe('墨色 渐变');
    expect(libraryItemTitle(item({ prompt: 'x'.repeat(60) }))).toHaveLength(43);
    expect(libraryItemTitle(item())).toBe('a1');
  });

  it('formats dates and sizes for a phone', () => {
    const now = new Date('2026-11-02T12:00:00.000Z');
    expect(formatLibraryDate('2026-11-02T09:00:00.000Z', now)).toBe('今天');
    expect(formatLibraryDate('2026-11-01T09:00:00.000Z', now)).toBe('昨天');
    expect(formatLibraryDate('2026-10-20T09:00:00.000Z', now)).toBe('10月20日');
    expect(formatLibraryDate('2025-10-20T09:00:00.000Z', now)).toBe('2025年10月');
    expect(formatLibraryDate('not-a-date', now)).toBe('日期未知');
    expect(formatLibraryBytes(0)).toBe('0 B');
    expect(formatLibraryBytes(980)).toBe('980 B');
    expect(formatLibraryBytes(2048)).toBe('2.0 KB');
    expect(formatLibraryBytes(920 * 1024)).toBe('920 KB');
    expect(formatLibraryBytes(11.8 * 1024 * 1024)).toBe('11.8 MB');
    expect(libraryItemMeta(item({ createdAt: '2026-11-02T09:00:00.000Z' }), now)).toBe('今天 · 2.0 KB');
    expect(
      libraryItemMeta(item({ kind: 'file', mimeType: 'application/pdf', createdAt: '2026-11-02T09:00:00.000Z' }), now),
    ).toBe('今天 · 2.0 KB · application/pdf');
  });

  it('writes honest empty states per tab and search', () => {
    expect(emptyLibraryCopy('收藏', false).title).toBe('还没有收藏');
    expect(emptyLibraryCopy('视频', false).title).toBe('还没有视频');
    expect(emptyLibraryCopy('全部', false).title).toBe('资料库还是空的');
    expect(emptyLibraryCopy('全部', true).title).toBe('没有匹配的素材');
  });
});
