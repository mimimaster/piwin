/**
 * Worker side of the extension UI channel. Dialogs are request/response
 * frames the parent must answer; surface updates (ADR 0078) are one-way.
 */
import type { ExtensionUiPort } from '@piwin/contracts';
import type {
  WorkerExtensionUiPublishFrame,
  WorkerExtensionUiRequestFrame,
  WorkerExtensionUiResponseFrame,
  WorkerFrameContext,
} from '../rpc-sdk-worker-protocol.js';

type PendingExtensionUiRequest = {
  sessionId: string;
  resolve: (response: NonNullable<WorkerExtensionUiResponseFrame['result']>) => void;
  reject: (error: Error) => void;
};

export type WorkerExtensionUiChannelOptions = {
  sendFrame: (frame: WorkerExtensionUiRequestFrame | WorkerExtensionUiPublishFrame) => void;
  /** Frame context of a live session, including its active run. Throws when unknown. */
  resolveContext: (sessionId: string) => WorkerFrameContext;
};

export class WorkerExtensionUiChannel {
  private readonly pending = new Map<string, PendingExtensionUiRequest>();

  constructor(private readonly options: WorkerExtensionUiChannelOptions) {}

  createPort(sessionId: string): ExtensionUiPort {
    return {
      request: (input, signal) => {
        const requestId = `${sessionId}|ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const frame: WorkerExtensionUiRequestFrame = {
          type: 'extension-ui-request',
          id: requestId,
          context: this.options.resolveContext(sessionId),
          kind: input.kind,
          title: input.title,
          ...(input.message ? { message: input.message } : {}),
          ...(input.options ? { options: input.options } : {}),
          ...(input.placeholder ? { placeholder: input.placeholder } : {}),
        };
        return new Promise((resolve, reject) => {
          this.pending.set(requestId, { sessionId, resolve, reject });
          if (signal.aborted) {
            this.pending.delete(requestId);
            reject(new Error('extension UI request aborted'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              const pendingRequest = this.pending.get(requestId);
              if (pendingRequest) {
                this.pending.delete(requestId);
                pendingRequest.reject(new Error('extension UI request aborted'));
              }
            },
            { once: true },
          );
          try {
            this.options.sendFrame(frame);
          } catch (error) {
            this.pending.delete(requestId);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
      publish: (update) => {
        this.options.sendFrame({
          type: 'extension-ui-publish',
          context: this.options.resolveContext(sessionId),
          update,
        });
      },
    };
  }

  handleResponse(frame: WorkerExtensionUiResponseFrame): void {
    const pendingRequest = this.pending.get(frame.id);
    if (!pendingRequest) {
      return;
    }
    this.pending.delete(frame.id);
    if (frame.ok && frame.result) {
      pendingRequest.resolve(frame.result);
      return;
    }
    pendingRequest.reject(new Error(frame.error ?? 'extension UI request failed'));
  }

  /** Settle every open dialog of a dropped session so its awaiting extension resumes. */
  rejectSession(sessionId: string, error: Error): void {
    for (const [requestId, pendingRequest] of this.pending) {
      if (pendingRequest.sessionId !== sessionId) continue;
      this.pending.delete(requestId);
      pendingRequest.reject(error);
    }
  }
}
