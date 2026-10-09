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
    onError: vi.fn(),
  });
  return { prompts, modals, sent };
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
});
