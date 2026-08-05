/** Pi SDK backend adapter. Product policy is compiled by host-runtime. */

import type {
  BackendSessionHandle,
  CreateBackendSessionInput,
  PiSessionBackend,
} from './backends/pi-session-backend.js';
import {
  InProcessSdkSessionBackend,
  type InProcessSdkSessionBackendOptions,
} from './backends/in-process-sdk-session-backend.js';

export type PiSdkAdapterOptions = InProcessSdkSessionBackendOptions;

/**
 * Backend-only SDK adapter retained as the in-process Pi implementation.
 * It never loads product Settings, resources, trust, or application services.
 */
export class PiSdkAdapter implements PiSessionBackend {
  readonly mode = 'sdk' as const;
  readonly isolated = false;
  private readonly backend: InProcessSdkSessionBackend;

  constructor(options: PiSdkAdapterOptions = {}) {
    this.backend = new InProcessSdkSessionBackend(options);
  }

  createSession(input: CreateBackendSessionInput): Promise<BackendSessionHandle> {
    return this.backend.createSession(input);
  }

  dropSession(sessionId: string): Promise<void> {
    return this.backend.dropSession(sessionId);
  }

  dropSessionGeneration(sessionId: string, runtimeGenerationId: string): Promise<void> {
    return this.backend.dropSessionGeneration(sessionId, runtimeGenerationId);
  }

  dispose(): Promise<void> {
    return this.backend.dispose();
  }
}
