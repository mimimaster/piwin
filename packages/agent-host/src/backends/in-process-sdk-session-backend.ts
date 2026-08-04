/**
 * Phase 7 WP5: InProcessSdkSessionBackend.
 *
 * Wraps the existing in-process SDK path (`PiSdkAdapter.createSession`) so
 * the backend interface is uniform. This is a thin adapter — the real
 * session creation logic stays in `sdk-adapter.ts` until WP7 consolidation.
 *
 * The backend does NOT provide process isolation (mode='sdk',
 * isolated=false).
 */

import type { SessionHandle, ModelRef, ThinkingLevel } from '@piwin/contracts';
import type {
  PiSessionBackend,
  BackendSessionHandle,
  CreateBackendSessionInput,
  PreparedPromptInput,
} from './pi-session-backend.js';
import type { PiSdkAdapter, PiSdkAdapterOptions } from '../sdk-adapter.js';
import type { CreateSessionInput, PromptInput } from '@piwin/contracts';

export type InProcessSdkSessionBackendOptions = {
  /** Factory that creates the underlying PiSdkAdapter. */
  createAdapter: () => PiSdkAdapter;
  /** Adapter options for session creation (passed through to PiSdkAdapter). */
  adapterOptions: PiSdkAdapterOptions;
};

export class InProcessSdkSessionBackend implements PiSessionBackend {
  readonly mode = 'sdk' as const;
  readonly isolated = false;
  private readonly adapter: PiSdkAdapter;
  private readonly sessions = new Map<string, SessionHandle>();

  constructor(options: InProcessSdkSessionBackendOptions) {
    this.adapter = options.createAdapter();
  }

  async createSession(input: CreateBackendSessionInput): Promise<BackendSessionHandle> {
    // The SDK backend receives a CreateSessionInput derived from the
    // blueprint. The blueprint's workingDirectory/scope/model drive the
    // session location. The SDK path resolves providers from live Settings,
    // not the envelope — but the envelope's paths/tools are the same.
    const sdkInput = deriveSdkInput(input);
    const handle = await this.adapter.createSession(sdkInput);
    this.sessions.set(handle.id, handle);
    return adaptSessionHandle(handle);
  }

  async dropSession(sessionId: string): Promise<void> {
    const handle = this.sessions.get(sessionId);
    if (handle) {
      this.sessions.delete(sessionId);
      try {
        await this.adapter.dropSession(sessionId);
      } catch {
        // best-effort
      }
    }
  }

  async dispose(): Promise<void> {
    this.sessions.clear();
    await this.adapter.dispose();
  }
}

/**
 * Derive a `CreateSessionInput` from the backend input. The SDK path
 * expects a scope + optional model/thinking; the blueprint's
 * workingDirectory becomes the cwd.
 */
function deriveSdkInput(input: CreateBackendSessionInput): CreateSessionInput {
  const blueprint = input.serializable;
  const sdkInput: CreateSessionInput = {
    scope: blueprint.scope,
    cwd: blueprint.workingDirectory,
  };
  if (blueprint.model) {
    // The blueprint carries { providerId, modelId } without protocol.
    // The SDK backend resolves the protocol from the live provider runtime.
    // We pass the model ref as-is; the SDK adapter resolves it internally.
    sdkInput.model = blueprint.model as ModelRef;
  }
  if (blueprint.thinkingLevel) {
    sdkInput.thinkingLevel = blueprint.thinkingLevel as ThinkingLevel;
  }
  return sdkInput;
}

/**
 * Adapt a `SessionHandle` (from the SDK adapter) to a `BackendSessionHandle`.
 * The backend handle's `prompt` receives a `PreparedPromptInput` and
 * converts it back to `PromptInput` for the SDK path.
 */
function adaptSessionHandle(handle: SessionHandle): BackendSessionHandle {
  return {
    id: handle.id,
    async prompt(prepared: PreparedPromptInput) {
      const promptInput: PromptInput = { text: prepared.text };
      if (prepared.streamingBehavior) {
        promptInput.streamingBehavior = prepared.streamingBehavior;
      }
      if (prepared.model) {
        promptInput.model = prepared.model as ModelRef;
      }
      if (prepared.thinkingLevel) {
        promptInput.thinkingLevel = prepared.thinkingLevel as ThinkingLevel;
      }
      // Images are already loaded by the preparation step; the SDK path
      // re-loads from attachments. For the backend, images are passed as
      // base64 data — the SDK adapter's prompt handles this via the
      // `images` option on Pi's prompt call. The SessionHandle.prompt
      // signature takes PromptInput which uses attachments, so we pass
      // an empty attachments array and rely on the SDK adapter's image
      // loading. This is a known gap that WP7 consolidation will close.
      await handle.prompt(promptInput);
    },
    async steer(message: string) {
      if (handle.steer) {
        await handle.steer(message);
      }
    },
    async followUp(message: string) {
      if (handle.followUp) {
        await handle.followUp(message);
      }
    },
    async abort() {
      await handle.abort();
    },
    subscribe(listener) {
      return handle.subscribe(listener);
    },
  };
}
