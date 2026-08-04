/**
 * Phase 7 WP5: PiSessionBackend interface.
 *
 * A backend owns the lifecycle of Pi sessions for one host mode. Both the
 * in-process SDK path and the worker RPC path implement this interface so
 * `PiSdkAdapter` / `PiRpcAdapter` become thin facades that delegate to a
 * backend instead of carrying divergent createSession mega-functions.
 *
 * The interface is intentionally minimal: create / drop / dispose. Per-turn
 * operations (prompt, steer, follow-up, abort) live on the returned handle
 * so the backend does not need to track active sessions itself.
 */

import type { AgentEvent, ModelRef, ThinkingLevel } from '@piwin/contracts';
import type { PromptInput } from '@piwin/contracts';
import type {
  SerializableBlueprint,
  SerializableProviderRuntime,
} from '../rpc/serializable-blueprint.js';

/**
 * A prepared prompt is the host-internal form after attachment resolution,
 * image loading, and per-turn model/thinking resolution. Backends receive
 * this instead of the raw `PromptInput` so both SDK and worker paths share
 * the same preparation logic.
 */
export type PreparedPromptInput = {
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
  streamingBehavior?: 'steer' | 'followUp';
  /** Per-turn model ref (already validated against the provider envelope). */
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};

/**
 * Handle returned by a backend's `createSession`. Mirrors the subset of
 * `SessionHandle` that the host runtime needs to drive a Pi session.
 */
export type BackendSessionHandle = {
  id: string;
  prompt(prepared: PreparedPromptInput): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
};

/**
 * Input passed to `PiSessionBackend.createSession`.
 *
 * The `serializable` blueprint is the exact, parent-compiled envelope that
 * the worker receives. The SDK backend may also use it directly since it
 * contains the same paths/providers/tools — the only difference is that
 * the SDK backend resolves providers from the live Settings runtime
 * instead of the envelope, but the envelope is the source of truth for
 * resource paths and tool allowlists.
 */
export type CreateBackendSessionInput = {
  productSessionId: string;
  /** Exact serializable blueprint (source of truth for paths/tools/providers). */
  serializable: SerializableBlueprint;
  /** Provider runtime envelope (worker path uses this directly). */
  providers: SerializableProviderRuntime[];
  /**
   * Optional host-internal context for the SDK backend (e.g. live model
   * runtime, resource loader). The worker backend ignores this.
   */
  sdkContext?: SdkBackendContext;
};

/**
 * Host-internal context for the in-process SDK backend. The worker backend
 * does not use this — it reconstructs everything from the serializable
 * envelope.
 */
export type SdkBackendContext = {
  /** Live model runtime (already has providers registered). */
  modelRuntime: unknown;
  /** Live resource loader (already built from Settings paths). */
  resourceLoader: unknown;
  /** Pi module handle (createAgentSession, etc.). */
  piModule: unknown;
};

/**
 * Backend interface implemented by both in-process SDK and worker RPC paths.
 */
export interface PiSessionBackend {
  /** Backend mode identifier for doctor/status reporting. */
  readonly mode: 'sdk' | 'rpc-worker' | 'rpc-fallback';

  /** True when the backend provides real process isolation. */
  readonly isolated: boolean;

  /**
   * Create a new Pi session from the compiled blueprint. The backend owns
   * the session until `dropSession` is called.
   */
  createSession(input: CreateBackendSessionInput): Promise<BackendSessionHandle>;

  /** Drop a session and release its resources. */
  dropSession(sessionId: string): Promise<void>;

  /** Release all sessions and shut down the backend (worker process, etc.). */
  dispose(): Promise<void>;
}

/**
 * Helper to prepare a `PromptInput` into a `PreparedPromptInput` before
 * passing it to a backend. Both SDK and worker backends receive the same
 * prepared form so image loading and per-turn resolution happen once.
 *
 * NOTE: image loading (base64 encoding from `~/.piwin/media/`) is done
 * here so the worker does not need filesystem access to media paths.
 */
export async function preparePromptInput(
  input: PromptInput,
  options: {
    loadImages?: (
      attachments: PromptInput['attachments'],
    ) => Promise<Array<{ data: string; mimeType: string }>>;
  },
): Promise<PreparedPromptInput> {
  const prepared: PreparedPromptInput = {
    text: input.text,
  };
  if (input.streamingBehavior) {
    prepared.streamingBehavior = input.streamingBehavior;
  }
  if (input.model) {
    prepared.model = input.model;
  }
  if (input.thinkingLevel) {
    prepared.thinkingLevel = input.thinkingLevel;
  }
  if (input.attachments && input.attachments.length > 0 && options.loadImages) {
    const images = await options.loadImages(input.attachments);
    if (images.length > 0) {
      prepared.images = images;
    }
  }
  return prepared;
}
