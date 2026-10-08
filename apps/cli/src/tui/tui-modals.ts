import type { Component, OverlayHandle, TUI } from '@earendil-works/pi-tui';
import type { HostCommand, HostPush } from '@piwin/contracts';
import { ChoiceOverlay, TextOverlay } from './choice-overlay.js';

type PendingModal = { key: string; open: () => void };

/**
 * One overlay at a time. Host-initiated prompts (permissions, extension
 * questions) wait in a queue behind whatever the user has open.
 */
export class TuiModalStack {
  private overlay: OverlayHandle | undefined;
  private readonly queue: PendingModal[] = [];

  public constructor(
    private readonly tui: TUI,
    /** Gets focus back when the last overlay closes. */
    private readonly focusTarget: Component,
    private readonly onClosed: () => void,
  ) {}

  public get isOpen(): boolean {
    return this.overlay !== undefined;
  }

  public show(component: Component): void {
    this.close(false);
    this.overlay = this.tui.showOverlay(component, { width: '80%', minWidth: 40, maxHeight: '80%' });
    this.tui.requestRender();
  }

  public close(pump = true): void {
    if (this.overlay === undefined) return;
    this.overlay.hide();
    this.overlay = undefined;
    this.onClosed();
    this.tui.setFocus(this.focusTarget);
    this.tui.requestRender();
    if (pump) this.pump();
  }

  /** A key identifies one Host request, so a replayed push cannot queue it twice. */
  public enqueue(key: string, open: () => void): void {
    if (this.queue.some((modal) => modal.key === key)) return;
    this.queue.push({ key, open });
  }

  public drop(key: string): void {
    const index = this.queue.findIndex((modal) => modal.key === key);
    if (index !== -1) this.queue.splice(index, 1);
  }

  public clearQueue(): void {
    this.queue.length = 0;
  }

  public pump(): void {
    if (this.overlay !== undefined) return;
    this.queue.shift()?.open();
  }
}

export type PermissionModalInput = {
  requestId: string;
  action: string;
  detail: string;
  /** "Always allow in this project" is only offered inside a project. */
  inProject: boolean;
  resolve: (command: HostCommand) => void;
};

export function createPermissionModal(input: PermissionModalInput): Component {
  const { requestId, resolve } = input;
  return new ChoiceOverlay({
    title: `需要确认：${input.action}`,
    message: input.detail,
    items: [
      { value: 'once', label: '允许一次' },
      { value: 'session', label: '本会话内始终允许' },
      ...(input.inProject ? [{ value: 'project', label: '本项目内始终允许' }] : []),
      { value: 'deny', label: '拒绝' },
    ],
    onSelect: (value) =>
      resolve(
        value === 'deny'
          ? { type: 'permission/resolve', requestId, decision: 'deny' }
          : {
              type: 'permission/resolve',
              requestId,
              decision: 'allow',
              rememberScope: value === 'session' ? 'session' : value === 'project' ? 'project' : 'once',
            },
      ),
    onCancel: () => resolve({ type: 'permission/resolve', requestId, decision: 'deny' }),
  });
}

export type ExtensionAnswer = { confirmed?: boolean; value?: string; cancelled?: boolean };

export function createExtensionModal(
  push: Extract<HostPush, { type: 'extension/ui_request' }>,
  answer: (fields: ExtensionAnswer) => void,
): Component {
  const message = push.message === undefined ? {} : { message: push.message };
  if (push.kind === 'input') {
    return new TextOverlay({
      title: push.title,
      ...message,
      onSubmit: (value) => answer({ value }),
      onCancel: () => answer({ cancelled: true }),
    });
  }
  const isConfirm = push.kind === 'confirm';
  return new ChoiceOverlay({
    title: push.title,
    ...message,
    items: isConfirm
      ? [
          { value: 'yes', label: '是' },
          { value: 'no', label: '否' },
        ]
      : (push.options ?? []).map((option) => ({ value: option, label: option })),
    onSelect: (value) => answer(isConfirm ? { confirmed: value === 'yes' } : { value }),
    onCancel: () => answer(isConfirm ? { confirmed: false } : { cancelled: true }),
  });
}
