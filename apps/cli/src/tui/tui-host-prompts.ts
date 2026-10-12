import type { HostCommand, HostPush, PermissionRequestContext } from '@piwin/contracts';
import { ViewerOverlay } from './viewer-overlay.js';
import { describePermissionPrompt } from './permission-prompt-view.js';
import { hostData, type TuiHostLink } from './tui-host-link.js';
import { createExtensionModal, createPermissionModal, type TuiModalStack } from './tui-modals.js';

export type TuiHostPromptsOptions = {
  link: TuiHostLink;
  modals: TuiModalStack;
  /** Directories tool paths are shown relative to. */
  getPathRoots: () => string[];
  /** "Always allow in this project" is only offered inside a project. */
  isInProject: () => boolean;
  /** A question is waiting: the person may have looked away. */
  onAttention: (message: string) => void;
  onError: (error: unknown) => void;
};

/**
 * Questions the Host asks while a turn runs (permissions, extension prompts):
 * each waits in the modal stack behind whatever the user has open, and its
 * answer goes back as a command.
 */
export class TuiHostPrompts {
  public constructor(private readonly options: TuiHostPromptsOptions) {}

  public askPermission(request: {
    requestId: string;
    action: string;
    detail: string;
    context?: PermissionRequestContext;
  }): void {
    const { requestId } = request;
    this.options.onAttention('需要你确认');
    const prompt = describePermissionPrompt(request, this.options.getPathRoots());
    const { modals } = this.options;
    const { fullPatch } = prompt;
    const showPrompt = (): void =>
      modals.swap(
        createPermissionModal({
          requestId,
          title: prompt.title,
          message: prompt.message,
          inProject: this.options.isInProject(),
          ...(prompt.backendOptions === undefined ? {} : { backendOptions: prompt.backendOptions }),
          ...(fullPatch === undefined
            ? {}
            : {
                onViewDiff: () =>
                  modals.swap(
                    new ViewerOverlay({ title: `${prompt.title} · diff`, lines: fullPatch.replace(/\n$/, '').split('\n'), onClose: showPrompt }),
                  ),
              }),
          resolve: (command) => this.answer(command),
        }),
      );
    modals.enqueue(`permission:${requestId}`, showPrompt);
  }

  public askExtension(push: Extract<HostPush, { type: 'extension/ui_request' }>): void {
    const { requestId } = push;
    this.options.onAttention('需要你回答');
    this.options.modals.enqueue(`extension:${requestId}`, () =>
      this.options.modals.show(
        createExtensionModal(push, (fields) => this.answer({ type: 'extension/ui_resolve', requestId, ...fields })),
      ),
    );
  }

  /** Answered from another shell (Desktop, phone): drop our copy. */
  public permissionResolvedElsewhere(requestId: string): void {
    this.options.modals.drop(`permission:${requestId}`);
  }

  private answer(command: HostCommand): void {
    this.options.modals.close();
    this.options.link.request(command).then(hostData, (error: unknown) => this.options.onError(error));
  }
}
