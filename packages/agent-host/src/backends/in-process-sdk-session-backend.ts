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
  private readonly sessions = new Map<string, BackendSessionHandle>();

  constructor(options: InProcessSdkSessionBackendOptions = {}) {
    this.createBackendSession =
      options.createSession ?? ((input) => createBackendSdkSession(input, options));
  }

  async createSession(input: CreateBackendSessionInput): Promise<BackendSessionHandle> {
    const handle = await this.createBackendSession(input);
    this.sessions.set(handle.id, handle);
    return handle;
  }

  async dropSession(sessionId: string): Promise<void> {
    const handle = this.sessions.get(sessionId);
    if (!handle) {
      return;
    }
    this.sessions.delete(sessionId);
    await handle.abort().catch(() => {
      // The Pi session may already have terminated; dropping remains best effort.
    });
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()];
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
