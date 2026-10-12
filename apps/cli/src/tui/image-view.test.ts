import type { HostCommand, HostResponse } from '@piwin/contracts';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { getCapabilities, setCapabilities } from '@earendil-works/pi-tui';
import { systemOpenCommand } from './tui-artifact-controller.js';
import {
  TuiImageStore,
  imagePlaceholder,
  latestImage,
  openLatestImage,
  parseImageSetting,
  resolveImageMode,
} from './image-view.js';
import { EMPTY_TRANSCRIPT, appendLocalUserMessage, applyAgentEvent, imagesFromAttachments, transcriptFromMessages } from './transcript-model.js';
import type { TuiHostLink } from './tui-host-link.js';

const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
// 1×1 transparent PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SHOT = { id: 'm1', mimeType: 'image/png', name: 'shot.png', byteSize: 2048, width: 800, height: 600 };

function store(mode: 'kitty' | null, setting?: string) {
  const sent: HostCommand[] = [];
  const written: string[] = [];
  const onLoaded = vi.fn();
  const request = async (command: HostCommand): Promise<HostResponse> => {
    sent.push(command);
    return {
      type: 'response', command: command.type, success: true,
      data: { status: 'ready', assetId: 'm1', sessionId: 's1', mimeType: 'image/png', byteSize: 68, base64Data: PNG },
    } as HostResponse;
  };
  const images = new TuiImageStore({
    link: { request } as unknown as TuiHostLink,
    getSessionId: () => 's1',
    onLoaded,
    write: (data) => written.push(data),
    env: setting === undefined ? {} : { PIWIN_IMAGES: setting },
    detect: () => mode,
  });
  return { images, sent, written, onLoaded };
}

describe('image settings', () => {
  it('reads PIWIN_IMAGES and stays off under tmux in auto', () => {
    expect(parseImageSetting('KITTY')).toBe('kitty');
    expect(parseImageSetting('bogus')).toBe('auto');
    expect(resolveImageMode('auto', {}, 'iterm2')).toBe('iterm2');
    expect(resolveImageMode('auto', { TMUX: '/tmp/tmux' }, 'kitty')).toBe('off');
    expect(resolveImageMode('auto', {}, null)).toBe('off');
    expect(resolveImageMode('kitty', { TMUX: 'x' }, null)).toBe('kitty');
    expect(resolveImageMode('off', {}, 'kitty')).toBe('off');
  });
});

describe('image placeholder', () => {
  it('names the image, format, size and bytes, linking a Host path', () => {
    expect(imagePlaceholder(SHOT)).toBe('🖼 shot.png · PNG 800×600 · 2 KB');
    expect(imagePlaceholder({ id: 'x', mimeType: 'image/jpeg' }, '加载中…')).toBe('🖼 x · JPG · 加载中…');
    const linked = imagePlaceholder({ ...SHOT, path: '/tmp/a b.png' });
    expect(linked).toContain('\x1b]8;;file:///tmp/a%20b.png');
    expect(strip(linked)).toBe('🖼 shot.png · PNG 800×600 · 2 KB');
  });
});

describe('TuiImageStore', () => {
  it('shows only placeholders when off, without reading bytes', () => {
    const { images, sent } = store(null);
    expect(images.render([SHOT], 80).map(strip)).toEqual([' ⎿ 🖼 shot.png · PNG 800×600 · 2 KB']);
    expect(sent).toHaveLength(0);
  });

  it('reads lazily once, then draws inline in kitty', async () => {
    const { images, sent, onLoaded } = store('kitty');
    expect(strip(images.render([SHOT], 80)[0] ?? '')).toContain('加载中…');
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());
    const lines = images.render([SHOT], 80);
    images.render([SHOT], 80);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'media/read', input: { sessionId: 's1', assetId: 'm1' } });
    expect(lines.some((line) => line.includes('\x1b_G'))).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(13);
  });

  it('toggles to placeholders and clears kitty pictures', () => {
    const { images, written } = store('kitty');
    expect(images.toggle()).toBe('图片：只显示占位行');
    expect(images.mode()).toBe('off');
    expect(images.toggle()).toBe('图片：内联显示（kitty）');
    expect(written.some((data) => data.includes('a=d'))).toBe(true);
  });
});

describe('transcript images', () => {
  it('keeps image attachments and leaves other files as a count', () => {
    const state = transcriptFromMessages([
      {
        id: 'u1', role: 'user', text: '看图', status: 'done',
        attachments: [
          { id: 'm1', kind: 'media', path: '/v/a.png', mimeType: 'image/png', byteSize: 10, source: 'paste' },
          { id: 'm2', kind: 'media', path: '/v/b.pdf', mimeType: 'application/pdf', byteSize: 10, source: 'drop' },
        ],
      },
      { id: 'u2', role: 'user', text: '旧的', status: 'done', attachmentCount: 2 },
    ] as never);
    const [first, second] = state.entries as Array<{ images?: unknown[]; annotations?: string[] }>;
    expect(first?.images).toHaveLength(1);
    expect(first?.annotations).toEqual(['1 个附件']);
    expect(second?.images).toBeUndefined();
    expect(second?.annotations).toEqual(['2 个附件']);
  });

  it('attaches tool images and finds the newest image', () => {
    let state = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'u1', 'hi', [], imagesFromAttachments([{ id: 'old', kind: 'media', mimeType: 'image/png' }]));
    state = applyAgentEvent(state, { type: 'message/start', messageId: 'a1', role: 'assistant' } as never);
    state = applyAgentEvent(state, { type: 'tool/start', responseMessageId: 'a1', toolCallId: 't1', toolName: 'screenshot' } as never);
    state = applyAgentEvent(state, {
      type: 'tool/end', responseMessageId: 'a1', toolCallId: 't1', isError: false,
      attachments: [{ id: 'new', kind: 'media', path: '/v/s.png', mimeType: 'image/png', byteSize: 1, source: 'generated' }],
    } as never);
    expect(latestImage(state)?.id).toBe('new');
    expect(latestImage(EMPTY_TRANSCRIPT)).toBeUndefined();
  });

  it('opens the newest image from a temp file', async () => {
    const { images } = store(null);
    const transcript = appendLocalUserMessage(EMPTY_TRANSCRIPT, 'u1', 'hi', [], [SHOT]);
    const open = vi.fn(async (_path: string) => {});
    await openLatestImage({ store: images, transcript, open, hint: vi.fn(), notice: vi.fn() });
    const filePath = open.mock.calls[0]?.[0] ?? '';
    expect(filePath).toMatch(/piwin-images\/m1\.png$/);
    expect((await readFile(filePath)).toString('base64')).toBe(PNG);
  });
});

describe('embedded in Desktop (PIWIN_IMAGES=iterm2)', () => {
  it('forces the iTerm2 protocol into pi-tui before start, even where detection finds nothing or tmux is set', () => {
    const before = getCapabilities();
    try {
      setCapabilities({ ...before, images: null });
      const images = new TuiImageStore({
        link: {} as TuiHostLink,
        getSessionId: () => undefined,
        onLoaded: () => {},
        write: () => {},
        env: { PIWIN_IMAGES: 'iterm2', TMUX: '/tmp/tmux-1/default' },
      });
      expect(getCapabilities().images).toBe('iterm2');
      expect(images.mode()).toBe('iterm2');
    } finally {
      setCapabilities(before);
    }
  });

  it('opens images with the OS opener, including Windows start', () => {
    expect(systemOpenCommand('win32', 'C:\\Users\\me\\AppData\\Local\\Temp\\piwin-images\\m1.png')).toEqual([
      'cmd', ['/c', 'start', '', 'C:\\Users\\me\\AppData\\Local\\Temp\\piwin-images\\m1.png'],
    ]);
    expect(systemOpenCommand('darwin', '/tmp/a.png')).toEqual(['open', ['/tmp/a.png']]);
    expect(systemOpenCommand('linux', '/tmp/a.png')).toEqual(['xdg-open', ['/tmp/a.png']]);
  });
});
