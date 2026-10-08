import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Component } from '@earendil-works/pi-tui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_TRANSCRIPT, applyAgentEvent, type TranscriptState } from './transcript-model.js';
import { TuiArtifactController } from './tui-artifact-controller.js';
import type { TuiModalStack } from './tui-modals.js';

const ENTER = '\r';
const DOWN = '\x1b[B';
const FENCE = '```';

function withArtifact(body: string): TranscriptState {
  const started = applyAgentEvent(EMPTY_TRANSCRIPT, { type: 'message/start', messageId: 'a1', role: 'assistant' });
  return applyAgentEvent(started, {
    type: 'message/text_delta',
    messageId: 'a1',
    delta: `${FENCE}artifact-html title="计数器"\n${body}\n${FENCE}`,
  });
}

class FakeModals {
  public current: (Component & { handleInput?: (data: string) => void }) | undefined;
  public show(component: Component): void {
    this.current = component;
  }
  public close(): void {
    this.current = undefined;
  }
  public press(...keys: string[]): void {
    for (const key of keys) this.current?.handleInput?.(key);
  }
  public text(): string {
    return (this.current?.render(80) ?? []).join('\n');
  }
}

describe('TuiArtifactController', () => {
  let exportRoot: string;

  beforeEach(async () => {
    exportRoot = await mkdtemp(path.join(tmpdir(), 'piwin-artifact-test-'));
  });

  afterEach(async () => {
    await rm(exportRoot, { recursive: true, force: true });
  });

  function setup(transcript: TranscriptState, openFile = vi.fn(async (_file: string) => undefined)) {
    const modals = new FakeModals();
    const port = { onHint: vi.fn(), onNotice: vi.fn(), onError: vi.fn() };
    const controller = new TuiArtifactController({
      modals: modals as unknown as TuiModalStack,
      getTranscript: () => transcript,
      openFile,
      exportRoot,
      ...port,
    });
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
    return { controller, modals, port, openFile, settle };
  }

  it('says so when the conversation has no artifact', () => {
    const { controller, modals, port } = setup(EMPTY_TRANSCRIPT);
    controller.open();
    expect(modals.current).toBeUndefined();
    expect(port.onHint).toHaveBeenCalledWith('当前这页对话里没有 artifact');
  });

  it('exports a sandboxed page under the export root and hands it to the browser', async () => {
    const { controller, modals, openFile, port, settle } = setup(withArtifact('<p>hi</p>'));
    controller.open();
    modals.press(ENTER, ENTER);
    await settle();
    const [filePath] = openFile.mock.calls[0] ?? [];
    expect(filePath?.startsWith(exportRoot)).toBe(true);
    expect(path.basename(filePath ?? '')).toBe('计数器.html');
    expect(await readFile(filePath ?? '', 'utf8')).toContain('<iframe sandbox="allow-scripts"');
    expect(port.onNotice).toHaveBeenCalledWith('info', `已在浏览器打开「计数器」\n${filePath}`);
  });

  it('still tells the user where the page is when no browser could be opened', async () => {
    const failing = vi.fn(async (_file: string) => {
      throw new Error('no opener');
    });
    const { controller, modals, port, settle } = setup(withArtifact('<p>hi</p>'), failing);
    controller.open();
    modals.press(ENTER, ENTER);
    await settle();
    expect(port.onNotice.mock.calls[0]?.[1]).toContain('没能自动打开浏览器，页面已导出到：');
    expect(port.onError).not.toHaveBeenCalled();
  });

  it('shows the source of an artifact', () => {
    const { controller, modals } = setup(withArtifact('<p>hi</p>'));
    controller.open();
    modals.press(ENTER, DOWN, ENTER);
    expect(modals.text()).toContain('<p>hi</p>');
  });

  it('offers only the source of an artifact the policy blocks', async () => {
    const { controller, modals, openFile, settle } = setup(withArtifact('<img src="https://example.com/x.png" alt="">'));
    controller.open();
    expect(modals.text()).toContain('已拦截：引用了外部资源');
    modals.press(ENTER);
    expect(modals.text()).not.toContain('在浏览器里打开');
    modals.press(ENTER);
    await settle();
    expect(openFile).not.toHaveBeenCalled();
    expect(modals.text()).toContain('example.com');
  });
});
