import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteSessionMessagesData } from '@piwin/contracts';
import { KEY, startTuiHarness, type TuiHarness } from './tui-e2e.harness.js';
import { hostData } from './tui-host-link.js';
import { latestImage } from './image-view.js';
import { transcriptFromMessages } from './transcript-model.js';

vi.setConfig({ testTimeout: 20_000 });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('TUI user image turns', () => {
  let tui: TuiHarness | undefined;
  afterEach(async () => {
    await tui?.dispose();
    tui = undefined;
    vi.unstubAllEnvs();
  });

  it('shows a typed image path as an image line, not raw attachment markup', async () => {
    vi.stubEnv('PIWIN_IMAGES', 'off');
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'piwin-img-')), 'test-image.png');
    writeFileSync(file, PNG);
    tui = await startTuiHarness({ embedded: true });
    await tui.submit(`look ${file}`);
    await tui.waitFor('mock_echo');
    await tui.waitForIdle();
    await tui.waitFor('🖼 test-image.png');
    expect(tui.seen()).not.toContain('<attached_image');
    expect(tui.seen()).toContain('[图片 ');
    // History from the Host's own message records keeps the image too.
    const data = hostData<RemoteSessionMessagesData>(await tui.asOtherShell({
      type: 'session/messages', sessionId: tui.sessionId(),
    }));
    const reopened = transcriptFromMessages(data.messages);
    expect(latestImage(reopened)).toMatchObject({ name: 'test-image.png', mimeType: 'image/png' });
    void KEY;
  });
});
