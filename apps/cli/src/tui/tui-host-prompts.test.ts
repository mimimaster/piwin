import type { Component } from '@earendil-works/pi-tui';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { TuiHostPrompts } from './tui-host-prompts.js';
import type { TuiHostLink } from './tui-host-link.js';
import type { TuiModalStack } from './tui-modals.js';

/** The queue-and-show behaviour of the real stack, without a terminal. */
class FakeModals {
  public current: (Component & { handleInput?: (data: string) => void }) | undefined;
  private readonly queue: Array<{ key: string; open: () => void }> = [];
  public enqueue(key: string, open: () => void): void {
    if (!this.queue.some((modal) => modal.key === key)) this.queue.push({ key, open });
  }
  public drop(key: string): void {
    const index = this.queue.findIndex((modal) => modal.key === key);
    if (index !== -1) this.queue.splice(index, 1);
  }
  public show(component: Component): void {
    this.current = component;
  }
  public swap(component: Component): void {
    this.current = component;
  }
  public close(): void {
    this.current = undefined;
  }
  public pump(): void {
    this.queue.shift()?.open();
  }
  public text(): string {
    return (this.current?.render(80) ?? []).join('\n');
  }
}

function setup() {
  const sent: HostCommand[] = [];
  const modals = new FakeModals();
  const onAttention = vi.fn();
  const prompts = new TuiHostPrompts({
    link: {
      request: async (command: HostCommand): Promise<HostResponse> => {
        sent.push(command);
        return { type: 'response', command: command.type, success: true, data: {} };
      },
    } as unknown as TuiHostLink,
    modals: modals as unknown as TuiModalStack,
    getPathRoots: () => ['/work/proj'],
    isInProject: () => true,
    onAttention,
    onError: vi.fn(),
  });
  return { prompts, modals, sent, onAttention };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('TuiHostPrompts', () => {
  it('shows a permission question and answers it through the Host', async () => {
    const { prompts, modals, sent } = setup();
    prompts.askPermission({
      requestId: 'r1',
      action: 'bash',
      detail: 'ask-all-no-match: ls /work/proj/src',
      context: { kind: 'command', summary: 's', command: 'ls /work/proj/src' },
    });
    modals.pump();
    expect(modals.text()).toContain('ls src');
    expect(modals.text()).not.toContain('ask-all-no-match');
    modals.current?.handleInput?.('\r');
    await settle();
    expect(sent).toEqual([{ type: 'permission/resolve', requestId: 'r1', decision: 'allow', rememberScope: 'once' }]);
    expect(modals.current).toBeUndefined();
  });

  it('answers a question restored after a reconnect with the agent’s own option', async () => {
    const { prompts, modals, sent } = setup();
    prompts.askPermission({
      requestId: 'r2',
      action: 'bash',
      detail: 'x',
      context: {
        kind: 'command',
        summary: 's',
        command: 'ls',
        backendAgentId: 'grok',
        backendOptions: [
          { optionId: 'yes', label: 'Yes', kind: 'allow_once' },
          { optionId: 'no', label: 'No', kind: 'reject_once' },
        ],
      },
    });
    modals.pump();
    modals.current?.handleInput?.('\r');
    await settle();
    expect(sent).toEqual([
      { type: 'permission/resolve', requestId: 'r2', decision: 'allow', backendOptionId: 'yes' },
    ]);
  });

  it('calls the person back when a question arrives', () => {
    const { prompts, onAttention } = setup();
    prompts.askPermission({ requestId: 'r5', action: 'bash', detail: 'ls' });
    expect(onAttention).toHaveBeenCalledWith('需要你确认');
  });

  it('drops a question another shell answered before it was shown', () => {
    const { prompts, modals } = setup();
    prompts.askPermission({ requestId: 'r3', action: 'bash', detail: 'ls' });
    prompts.permissionResolvedElsewhere('r3');
    modals.pump();
    expect(modals.current).toBeUndefined();
  });

  it('does not queue the same question twice', () => {
    const { prompts, modals } = setup();
    prompts.askPermission({ requestId: 'r4', action: 'bash', detail: 'ls' });
    prompts.askPermission({ requestId: 'r4', action: 'bash', detail: 'ls' });
    modals.pump();
    modals.close();
    modals.pump();
    expect(modals.current).toBeUndefined();
  });

  it('shows the proposed diff in a file-write prompt and opens the full patch on request', async () => {
    const { prompts, modals, sent } = setup();
    const body = Array.from({ length: 30 }, (_, index) => `+line ${index}`).join('\n');
    prompts.askPermission({
      requestId: 'r9',
      action: 'file-write',
      detail: 'a.ts',
      context: {
        kind: 'file-write',
        summary: 'file-write',
        paths: ['a.ts'],
        proposedChange: { path: 'a.ts', patch: `--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1,30 @@\n${body}\n`, additions: 30, deletions: 0 },
      },
    });
    modals.pump();
    const prompt = modals.text();
    expect(prompt).toContain('+line 18');
    expect(prompt).not.toContain('+line 25');
    expect(prompt).toContain('还有 11 行');
    expect(prompt).toContain('查看完整 diff');
    // once, session, project, diff, deny.
    for (let step = 0; step < 3; step += 1) modals.current?.handleInput?.('\x1b[B');
    modals.current?.handleInput?.('\r');
    expect(sent).toEqual([]);
    expect(modals.text()).toContain('+line 0');
    modals.current?.handleInput?.('\x1b');
    expect(modals.text()).toContain('查看完整 diff');
    modals.current?.handleInput?.('\r');
    await settle();
    expect(sent).toEqual([{ type: 'permission/resolve', requestId: 'r9', decision: 'allow', rememberScope: 'once' }]);
  });
});
