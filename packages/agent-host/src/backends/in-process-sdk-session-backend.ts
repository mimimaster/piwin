/** In-process Pi SDK implementation of the backend-neutral session seam. */

import type {
  BackendSessionHandle,
  CreateBackendSessionInput,
  PiSessionBackend,
} from './pi-session-backend.js';
import {
  createBackendSdkSession,
  type PiSdkBackendOptions,
} from './sdk-backend-session.js';

export type InProcessSdkSessionBackendOptions = PiSdkBackendOptions & {
  /** Test seam for exercising the backend without loading the Pi module. */
  createSession?: (input: CreateBackendSessionInput) => Promise<BackendSessionHandle>;
};

export class InProcessSdkSessionBackend implements PiSessionBackend {
  readonly mode = 'sdk' as const;
  readonly isolated = false;
  private readonly createBackendSession: (
    input: CreateBackendSessionInput,
  ) => Promise<BackendSessionHandle>;
  private readonly sessions = new Map<string, { handle: BackendSessionHandle; runtimeGenerationId: string }>();

  constructor(options: InProcessSdkSessionBackendOptions = {}) {
    this.createBackendSession =
      options.createSession ?? ((input) => createBackendSdkSession(input, options));
  }

  async createSession(input: CreateBackendSessionInput): Promise<BackendSessionHandle> {
    const handle = await this.createBackendSession(input);
    this.sessions.set(sessionGenerationKey(handle.id, input.blueprint.runtimeGenerationId), {
      handle,
      runtimeGenerationId: input.blueprint.runtimeGenerationId,
    });
    return handle;
  }

  async dropSession(sessionId: string): Promise<void> {
    const matching = [...this.sessions.entries()].filter(([key, entry]) =>
      key.startsWith(`${sessionId}\u0000`) || entry.handle.id === sessionId,
    );
    for (const [key, entry] of matching) {
      this.sessions.delete(key);
      await entry.handle.abort().catch(() => {
        // The Pi session may already have terminated; dropping remains best effort.
      });
    }
  }

  async dropSessionGeneration(sessionId: string, runtimeGenerationId: string): Promise<void> {
    const key = sessionGenerationKey(sessionId, runtimeGenerationId);
    const entry = this.sessions.get(key);
    if (!entry) {
      return;
    }
    this.sessions.delete(key);
    await entry.handle.abort().catch(() => {
      // The Pi session may already have terminated; dropping remains best effort.
    });
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()].map((entry) => entry.handle);
    this.sessions.clear();
    await Promise.all(
      sessions.map(async (handle) => {
        await handle.abort().catch(() => {
          // The Pi session may already have terminated during shutdown.
        });
      }),
    );
  }
}

function sessionGenerationKey(sessionId: string, runtimeGenerationId: string): string {
  return `${sessionId}\u0000${runtimeGenerationId}`;
}
