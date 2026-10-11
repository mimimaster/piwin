import type { RemoteSessionMessagesData } from '@piwin/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readClipboardImage } from './clipboard-image.js';
import { KEY, startTuiHarness, type TuiHarness } from './tui-e2e.harness.js';
import { hostData } from './tui-host-link.js';

vi.mock('./clipboard-image.js', () => ({ readClipboardImage: vi.fn() }));
vi.setConfig({ testTimeout: 20_000 });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PASTE_IMAGE = '\x16';

/** Only the OS clipboard is mocked; editor, media upload and Host prompt are real. */
describe('TUI clipboard image markers', () => {
  let tui: TuiHarness | undefined;

  beforeEach(() => {
    vi.mocked(readClipboardImage).mockReset().mockResolvedValue({
      kind: 'image', image: { bytes: PNG, mimeType: 'image/png' },
    });
  });

  afterEach(async () => {
    await tui?.dispose();
    tui = undefined;
  });

  it('inserts numbered images at the cursor and sends both native attachments', async () => {
    tui = await startTuiHarness({ embedded: true });
    await tui.press('前', '后', '\x1b[D', PASTE_IMAGE);
    await tui.waitFor('前【image 1】后');
    await tui.press(PASTE_IMAGE);
    await tui.waitFor('前【image 1】【image 2】后');
    await tui.press(KEY.enter);
    await tui.waitFor('mock_echo');
    await tui.waitForIdle();
    const data = hostData<RemoteSessionMessagesData>(await tui.asOtherShell({
      type: 'session/messages', sessionId: tui.sessionId(),
    }));
    const message = data.messages.find((entry) => entry.role === 'user');
    expect(message?.text).toBe('前【image 1】【image 2】后');
    expect(message?.attachments).toHaveLength(2);
    for (const attachment of message?.attachments ?? []) {
      expect(attachment).toMatchObject({ kind: 'media', mimeType: 'image/png', source: 'paste' });
      expect(attachment.path).toMatch(/^remote-asset:/);
    }
    expect(new Set(message?.attachments?.map((entry) => entry.id)).size).toBe(2);
    tui.mark();
    await tui.press(PASTE_IMAGE);
    await tui.waitFor('【image 1】');
    await tui.press(KEY.enter);
    await tui.waitFor('you said: 【image 1】');
  });

  it('leaves no marker for an empty clipboard or a refused upload', async () => {
    tui = await startTuiHarness();
    await tui.submit('先建会话');
    await tui.waitFor('mock_echo');
    await tui.waitForIdle();
    tui.mark();
    vi.mocked(readClipboardImage).mockResolvedValueOnce({ kind: 'empty' });
    await tui.press('原', '文', PASTE_IMAGE);
    await tui.waitFor('剪贴板里没有图片');
    const gate = tui.holdRequests('media/save-begin');
    await tui.press(PASTE_IMAGE);
    await tui.waitFor('附件上传中');
    gate.fail('upload refused');
    await tui.waitFor('粘贴图片失败：upload refused');
    expect(tui.seen()).not.toContain('【image');
    await tui.press(PASTE_IMAGE);
    await tui.waitFor('原文【image 1】');
  });

  it('keeps the marker and attachment when a send is refused, then resends once', async () => {
    tui = await startTuiHarness();
    await tui.press(PASTE_IMAGE);
    await tui.waitFor('【image 1】');
    const gate = tui.holdRequests('session/prompt');
    await tui.press(KEY.enter);
    gate.fail('prompt refused');
    await tui.waitFor('prompt refused');
    tui.mark();
    await tui.press('重', '试');
    await tui.waitFor('【image 1】重试');
    await tui.press(KEY.enter);
    await tui.waitFor('mock_echo');
    await tui.waitForIdle();
    const data = hostData<RemoteSessionMessagesData>(await tui.asOtherShell({
      type: 'session/messages', sessionId: tui.sessionId(),
    }));
    const users = data.messages.filter((entry) => entry.role === 'user');
    expect(users).toHaveLength(1);
    expect(users[0]?.text).toBe('【image 1】重试');
    expect(users[0]?.attachments).toHaveLength(1);
  });
});
