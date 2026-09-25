// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import type { MobileTranscriptMessage } from '../../mobile-transcript.js';
import type { InkstoneHost } from '../host/inkstone-host-context.js';
import { fakeHost, fakeHostContext, renderInkstone, type RenderedInkstone } from '../test-host-fixture.js';

let rendered: RenderedInkstone | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

const MESSAGES: MobileTranscriptMessage[] = [
  { id: 'u1', role: 'user', text: '列一下目录', createdAt: '2026-09-25T10:00:00.000Z', status: 'done' },
  {
    id: 'a1',
    role: 'assistant',
    text: '',
    thinking: '先跑 ls',
    createdAt: '2026-09-25T10:00:01.000Z',
    status: 'done',
    runId: 'r1',
    model: { providerId: 'deepseek', modelId: 'deepseek-flash' },
    toolCalls: [
      {
        id: 'call-1',
        name: 'bash',
        status: 'done',
        presentation: { kind: 'shell', title: 'bash', command: 'ls -la', exitCode: 0, durationMs: 120 },
      },
    ],
  },
  {
    id: 'a2',
    role: 'assistant',
    text: '目录里有 3 个文件。',
    createdAt: '2026-09-25T10:00:03.000Z',
    endedAt: '2026-09-25T10:00:05.000Z',
    status: 'done',
    runId: 'r1',
    model: { providerId: 'deepseek', modelId: 'deepseek-flash' },
  },
];

function renderChat(): void {
  const host = fakeHost({
    activeSessionId: 's1',
    messages: MESSAGES,
    configuredModels: [
      { providerId: 'deepseek', modelId: 'deepseek-flash', label: 'DeepSeek Flash' } as InkstoneHost['configuredModels'][number],
    ],
  });
  const context = fakeHostContext(host);
  context.modelSelection = { ...context.modelSelection, providerId: 'deepseek', modelId: 'deepseek-flash' };
  rendered = renderInkstone(context, 'chat');
}

describe('connected chat transcript', () => {
  it('renders one assistant head per run with the tool chain folded under it', () => {
    renderChat();
    expect(document.querySelectorAll('.turn').length).toBe(1);
    expect(document.querySelectorAll('.turn .message-head').length).toBe(1);
    expect(document.querySelector('.turn .message-head')?.textContent).toContain('DeepSeek Flash');
    expect(document.querySelector('.work-h')?.textContent).toContain('工作了 4 秒');
    expect(document.querySelector('.work-h')?.textContent).toContain('1 个工具');
    expect(document.querySelector('.assistant-prose')?.textContent).toContain('目录里有 3 个文件。');

    const fold = document.querySelector<HTMLButtonElement>('.work-h');
    act(() => {
      fold?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const row = document.querySelector('.tr');
    expect(row?.textContent).toContain('bash');
    expect(row?.textContent).toContain('ls -la');
    expect(row?.textContent).toContain('120ms');
  });

  it('opens and closes the model sheet from the composer', () => {
    renderChat();
    const modelButton = document.querySelector<HTMLButtonElement>('.model-button');
    expect(modelButton?.textContent).toContain('DeepSeek Flash');
    act(() => {
      modelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector<HTMLDialogElement>('dialog.inkstone-sheet')?.open).toBe(true);
    const closeButton = [...document.querySelectorAll('dialog button')].find((button) =>
      button.getAttribute('aria-label')?.includes('关闭弹层'),
    );
    act(() => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector<HTMLDialogElement>('dialog.inkstone-sheet')?.open).toBe(false);
  });
});
