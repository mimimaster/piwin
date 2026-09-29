/**
 * Parent side of the worker extension UI channel: answers dialog frames and
 * forwards one-way surface updates (ADR 0080) to the owning backend session.
 */
import type { ExtensionUiSurfaceUpdate } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import type {
  WorkerExtensionUiPublishFrame,
  WorkerExtensionUiRequestFrame,
  WorkerExtensionUiResponseFrame,
} from '../rpc-sdk-worker-protocol.js';

export type WorkerExtensionUiDialogRequest = {
  sessionId: string;
  runtimeGenerationId: string;
  kind: 'confirm' | 'select' | 'input';
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
};

export type WorkerExtensionUiDialogResult = NonNullable<WorkerExtensionUiResponseFrame['result']>;

export type WorkerExtensionUiRequestHandler = (
  request: WorkerExtensionUiDialogRequest,
) => Promise<WorkerExtensionUiDialogResult>;

export type WorkerExtensionUiPublishHandler = (publication: {
  sessionId: string;
  runtimeGenerationId: string;
  update: ExtensionUiSurfaceUpdate;
}) => void;

/** Resolve one dialog frame through `handler` and answer it with `writeFrame`. */
export async function relayExtensionUiRequest(
  frame: WorkerExtensionUiRequestFrame,
  handler: WorkerExtensionUiRequestHandler | undefined,
  writeFrame: (frame: WorkerExtensionUiResponseFrame) => void,
): Promise<void> {
  const respond = (ok: boolean, result?: WorkerExtensionUiDialogResult, error?: string): void => {
    writeFrame({
      type: 'extension-ui-response',
      id: frame.id,
      context: frame.context,
      ok,
      ...(result ? { result } : {}),
      ...(error ? { error } : {}),
    });
  };
  if (!handler) {
    respond(false, undefined, 'no extension UI handler configured');
    return;
  }
  try {
    const result = await handler({
      sessionId: frame.context.sessionId,
      runtimeGenerationId: frame.context.runtimeGenerationId,
      kind: frame.kind,
      title: frame.title,
      ...(frame.message ? { message: frame.message } : {}),
      ...(frame.options ? { options: frame.options } : {}),
      ...(frame.placeholder ? { placeholder: frame.placeholder } : {}),
    });
    respond(true, result);
  } catch (error: unknown) {
    respond(false, undefined, formatError(error));
  }
}

export function relayExtensionUiPublish(
  frame: WorkerExtensionUiPublishFrame,
  handler: WorkerExtensionUiPublishHandler | undefined,
): void {
  handler?.({
    sessionId: frame.context.sessionId,
    runtimeGenerationId: frame.context.runtimeGenerationId,
    update: frame.update,
  });
}
