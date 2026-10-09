import type { Component, OverlayHandle, TUI } from '@earendil-works/pi-tui';
import type { BackendPermissionOption, HostCommand, HostPush } from '@piwin/contracts';
import { isAllowPermissionOptionKind } from '@piwin/contracts';
import { ChoiceOverlay, TextOverlay } from './choice-overlay.js';

type PendingModal = { key: string; open: () => void };

/**
 * One overlay at a time. Host-initiated prompts (permissions, extension
 * questions) wait in a queue behind whatever the user has open.
 */
export class TuiModalStack {
  private overlay: OverlayHandle | undefined;
  /** Key of the queued Host request the open overlay answers, when it is one. */
  private shownKey: string | undefined;
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
    this.shownKey = undefined;
    this.onClosed();
    this.tui.setFocus(this.focusTarget);
    this.tui.requestRender();
    if (pump) this.pump();
  }

  /** A key identifies one Host request, so a replayed push cannot queue it twice. */
  public enqueue(key: string, open: () => void): void {
    if (this.shownKey === key || this.queue.some((modal) => modal.key === key)) return;
    this.queue.push({ key, open });
  }

  /** The request was answered elsewhere: forget it, and take its dialog down if it is the one open. */
  public drop(key: string): void {
    if (this.shownKey === key) {
      this.close();
      return;
    }
    const index = this.queue.findIndex((modal) => modal.key === key);
    if (index !== -1) this.queue.splice(index, 1);
  }

  public clearQueue(): void {
    this.queue.length = 0;
  }

  public pump(): void {
    if (this.overlay !== undefined) return;
    const next = this.queue.shift();
    if (next === undefined) return;
    next.open();
    // `open` shows its dialog, and showing clears the key: set it after.
    if (this.overlay !== undefined) this.shownKey = next.key;
  }
}

export type PermissionModalInput = {
  requestId: string;
  title: string;
  message: string;
  /** "Always allow in this project" is only offered inside a project. */
  inProject: boolean;
  /**
   * An external agent decided the choices (ADR 0082): they are shown as given
   * and answered by option id; piwin's own remember scopes do not apply.
   */
  backendOptions?: readonly BackendPermissionOption[];
  resolve: (command: HostCommand) => void;
};

export function createPermissionModal(input: PermissionModalInput): Component {
  const { requestId, resolve } = input;
  const denyOnce: HostCommand = { type: 'permission/resolve', requestId, decision: 'deny' };
  const backendOptions = input.backendOptions;
  if (backendOptions !== undefined && backendOptions.length > 0) {
    // Allow choices first, refusals last, each group in the agent's order.
    const ordered = [
      ...backendOptions.filter((option) => isAllowPermissionOptionKind(option.kind)),
      ...backendOptions.filter((option) => !isAllowPermissionOptionKind(option.kind)),
    ];
    return new ChoiceOverlay({
      title: input.title,
      message: input.message,
      items: ordered.map((option) => ({ value: option.optionId, label: option.label })),
      onSelect: (value) => {
        const chosen = ordered.find((option) => option.optionId === value);
        resolve(
          chosen === undefined
            ? denyOnce
            : {
                type: 'permission/resolve',
                requestId,
                decision: isAllowPermissionOptionKind(chosen.kind) ? 'allow' : 'deny',
                backendOptionId: chosen.optionId,
              },
        );
      },
      onCancel: () => {
        // Refusing must still name one of the agent's options; the first refusal is the closest to "no".
        const refusal = ordered.find((option) => !isAllowPermissionOptionKind(option.kind));
        resolve(
          refusal === undefined
            ? denyOnce
            : { ...denyOnce, backendOptionId: refusal.optionId },
        );
      },
    });
  }
  return new ChoiceOverlay({
    title: input.title,
    message: input.message,
    items: [
      { value: 'once', label: '允许一次' },
      { value: 'session', label: '本会话内始终允许' },
      ...(input.inProject ? [{ value: 'project', label: '本项目内始终允许' }] : []),
      { value: 'deny', label: '拒绝' },
    ],
    onSelect: (value) =>
      resolve(
        value === 'deny'
          ? denyOnce
          : {
              type: 'permission/resolve',
              requestId,
              decision: 'allow',
              rememberScope: value === 'session' ? 'session' : value === 'project' ? 'project' : 'once',
            },
      ),
    onCancel: () => resolve(denyOnce),
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
