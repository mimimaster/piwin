import type {
  HostCommand,
  HostPush,
  HostResponse,
  PushSink,
  RemoteSinkId,
} from '@piwin/contracts';
import type {
  HostForegroundRunSnapshot,
  HostPendingPermissionSnapshot,
  HostRuntimeOptions,
} from './host-runtime-types.js';
export type {
  HostRuntimeOptions,
  HostRuntimeTestFixture,
  HostForegroundRunSnapshot,
  HostPendingPermissionSnapshot,
} from './host-runtime-types.js';
import { initializeHostRuntime } from './host-runtime-init.js';
import { disposeHostRuntime } from './host-runtime-dispose.js';
import {
  handleCommand,
  handleCommandWithTranscriptLease,
} from './host-runtime-command-dispatch.js';
import type { BrowserFrameBytesSink } from './host-runtime-services.js';
import {
  listForegroundRuns,
  listPendingPermissionRequests,
} from './host-runtime-status.js';
import {
  publishHostPush,
  attachHostPushSink,
  countHostProductionPushSinks,
  detachHostPushSink,
} from './host-push-publisher.js';
import { HostRuntimeSessionSurface } from './host-runtime-session-surface.js';

export class HostRuntime extends HostRuntimeSessionSurface {

  constructor(options: HostRuntimeOptions) {
    super();
    initializeHostRuntime(this.asKernel(), options);
  }


  runWithDevicePrincipal<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    return this.devicePrincipalStore.run(deviceId, fn);
  }


  async dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }
    this.hostClosing = true;
    this.disposePromise = disposeHostRuntime(this.asKernel());
    return this.disposePromise;
  }


  async disposeInternal(): Promise<void> {
    return disposeHostRuntime(this.asKernel());
  }


  noteAuthDeviceConnected(deviceId: string): void {
    this.subscriptionAuth?.noteDeviceConnected(deviceId);
  }


  noteAuthDeviceDisconnected(deviceId: string): void {
    this.subscriptionAuth?.noteDeviceDisconnected(deviceId);
  }


  async handleCommand(
    command: HostCommand,
    options?: { idempotencyKey?: string },
  ): Promise<HostResponse> {
    const key = options?.idempotencyKey?.trim();
    if (key) {
      return this.commandRequestStore.run({ idempotencyKey: key }, () =>
        handleCommand(this.asKernel(), command),
      );
    }
    return handleCommand(this.asKernel(), command);
  }


  async handleCommandWithTranscriptLease(command: HostCommand): Promise<HostResponse> {
    return handleCommandWithTranscriptLease(this.asKernel(), command);
  }


  push(message: HostPush): void {
    return publishHostPush(this.asKernel(), message);
  }


  listForegroundRuns(): HostForegroundRunSnapshot[] {
    return listForegroundRuns(this.asKernel());
  }


  listPendingPermissionRequests(): HostPendingPermissionSnapshot[] {
    return listPendingPermissionRequests(this.asKernel());
  }


  attachPushSink(sink: PushSink): () => void {
    return attachHostPushSink(this.asKernel(), sink);
  }

  /**
   * Register a raw browser-frame sink. Frames are delivered only while the
   * browser session is alive; the sink must not retain the bytes.
   */

  attachBrowserFrameSink(sink: BrowserFrameBytesSink): () => void {
    const kernel = this.asKernel();
    kernel.browserFrameSinks.add(sink);
    return () => {
      kernel.browserFrameSinks.delete(sink);
    };
  }


  countProductionPushSinks(): number {
    return countHostProductionPushSinks(this.asKernel());
  }


  detachPushSink(id: RemoteSinkId): void {
    return detachHostPushSink(this.asKernel(), id);
  }

}
