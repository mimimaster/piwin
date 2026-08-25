import { randomUUID } from 'node:crypto';
import type {
  ClientToolCancelFrame,
  ClientToolCancelReason,
  ClientToolExecutionOutcome,
  ClientToolExecutionPort,
  ClientToolExecutionRequest,
  ClientToolRequestFrame,
  ClientToolResultFrame,
} from '@piwin/contracts';
import {
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  CLIENT_TOOL_DEFAULT_DEADLINE_MS,
  CLIENT_TOOL_MAX_DEADLINE_MS,
  MAX_APPLE_HEALTH_PENDING_PER_DEVICE,
  MAX_CLIENT_TOOL_PENDING_HOST,
  isClientToolTimestampWithinSkew,
} from '@piwin/contracts';
import type { DeviceCapabilityRegistry } from './device-capability-registry.js';

export type DeviceToolBrokerLogger = (event: {
  operation: 'advertise' | 'request' | 'result' | 'cancel';
  capabilityId?: string;
  requestId?: string;
  deviceIdSuffix?: string;
  status?: string;
  durationMs?: number;
  payloadBytes?: number;
  pending?: number;
}) => void;

export type DeviceToolConnectionAttachment = {
  deviceId: string;
  connectionEpoch: string;
  capabilities: readonly { id: string; version: number }[];
  send: (frame: ClientToolRequestFrame | ClientToolCancelFrame) => void;
  clientType?: string;
  clientVersion?: string;
};

type AttachedConnection = {
  deviceId: string;
  connectionEpoch: string;
  attachedAt: number;
  capabilityIds: ReadonlySet<string>;
  send: (frame: ClientToolRequestFrame | ClientToolCancelFrame) => void;
};

type PendingCall = {
  requestId: string;
  capabilityId: string;
  deviceId: string;
  connectionEpoch: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  issuedAtMs: number;
  deadlineAtMs: number;
  timer: ReturnType<typeof setTimeout>;
  abortHandler: () => void;
  signal: AbortSignal;
  resolve: (outcome: ClientToolExecutionOutcome) => void;
  settled: boolean;
};

export type DeviceToolBrokerOptions = {
  registry: DeviceCapabilityRegistry;
  now?: () => number;
  randomId?: () => string;
  logger?: DeviceToolBrokerLogger;
};

export class DeviceToolBroker implements ClientToolExecutionPort {
  private readonly registry: DeviceCapabilityRegistry;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly logger: DeviceToolBrokerLogger;
  private readonly connections = new Map<string, AttachedConnection>();
  private readonly pending = new Map<string, PendingCall>();
  private disposed = false;

  public constructor(options: DeviceToolBrokerOptions) {
    this.registry = options.registry;
    this.now = options.now ?? Date.now;
    this.randomId = options.randomId ?? randomUUID;
    this.logger = options.logger ?? (() => undefined);
  }

  public attach(attachment: DeviceToolConnectionAttachment): void {
    if (this.disposed) {
      return;
    }
    const capabilityIds = new Set(attachment.capabilities.map((item) => item.id));
    this.connections.set(attachment.connectionEpoch, {
      deviceId: attachment.deviceId,
      connectionEpoch: attachment.connectionEpoch,
      attachedAt: this.now(),
      capabilityIds,
      send: attachment.send,
    });
    void this.registry
      .recordAdvertisement({
        deviceId: attachment.deviceId,
        capabilities: attachment.capabilities,
        ...(attachment.clientType === undefined ? {} : { clientType: attachment.clientType }),
        ...(attachment.clientVersion === undefined
          ? {}
          : { clientVersion: attachment.clientVersion }),
      })
      .catch(() => undefined);
    this.logger({
      operation: 'advertise',
      deviceIdSuffix: suffix(attachment.deviceId),
      pending: this.pending.size,
    });
  }

  public replaceCapabilities(
    connectionEpoch: string,
    capabilities: readonly { id: string; version: number }[],
  ): void {
    const connection = this.connections.get(connectionEpoch);
    if (connection === undefined) {
      return;
    }
    connection.capabilityIds = new Set(capabilities.map((item) => item.id));
    void this.registry
      .recordAdvertisement({
        deviceId: connection.deviceId,
        capabilities,
      })
      .catch(() => undefined);
  }

  public detach(connectionEpoch: string): void {
    const connection = this.connections.get(connectionEpoch);
    this.connections.delete(connectionEpoch);
    if (connection === undefined) {
      return;
    }
    for (const pending of [...this.pending.values()]) {
      if (pending.connectionEpoch === connectionEpoch && !pending.settled) {
        this.settle(pending, {
          ok: false,
          reason: 'client-device-disconnected',
          retryable: true,
        });
      }
    }
  }

  public admitResult(input: {
    connectionEpoch: string;
    deviceId: string;
    frame: ClientToolResultFrame;
  }): void {
    const pending = this.pending.get(input.frame.requestId);
    if (pending === undefined || pending.settled) {
      this.logger({
        operation: 'result',
        requestId: input.frame.requestId,
        status: 'ignored',
        pending: this.pending.size,
      });
      return;
    }
    if (
      pending.connectionEpoch !== input.connectionEpoch ||
      pending.deviceId !== input.deviceId
    ) {
      this.logger({
        operation: 'result',
        requestId: pending.requestId,
        status: 'ignored-binding',
        pending: this.pending.size,
      });
      return;
    }
    if (
      !isClientToolTimestampWithinSkew({
        timestamp: input.frame.completedAt,
        issuedAtMs: pending.issuedAtMs,
        deadlineAtMs: pending.deadlineAtMs,
      })
    ) {
      this.settle(pending, { ok: false, reason: 'invalid-client-result', retryable: false });
      return;
    }
    this.settle(pending, mapResult(pending.deviceId, input.frame));
  }

  public pendingCount(): number {
    return this.pending.size;
  }

  public async execute(
    request: ClientToolExecutionRequest,
    signal: AbortSignal,
  ): Promise<ClientToolExecutionOutcome> {
    if (this.disposed) {
      return { ok: false, reason: 'cancelled', retryable: false };
    }
    if (signal.aborted) {
      return { ok: false, reason: 'cancelled', retryable: false };
    }
    const deadlineMs = clampDeadline(request.deadlineMs);
    const target = this.selectTarget(request.capabilityId, request.preferredDeviceId);
    if (target === undefined) {
      return { ok: false, reason: 'client-device-unavailable', retryable: true };
    }
    if (this.pending.size >= MAX_CLIENT_TOOL_PENDING_HOST) {
      return { ok: false, reason: 'client-device-unavailable', retryable: true };
    }
    if (
      request.capabilityId === APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID &&
      this.healthPendingFor(target.deviceId) >= MAX_APPLE_HEALTH_PENDING_PER_DEVICE
    ) {
      return { ok: false, reason: 'client-device-unavailable', retryable: true };
    }

    const issuedAtMs = this.now();
    const requestId = this.randomId();
    const deadlineAtMs = issuedAtMs + deadlineMs;
    const frame: ClientToolRequestFrame = {
      type: 'client-tool/request',
      requestId,
      capabilityId: request.capabilityId,
      sessionId: request.sessionId,
      runId: request.runId,
      toolCallId: request.toolCallId,
      arguments: request.arguments,
      deadlineAt: new Date(deadlineAtMs).toISOString(),
      timeoutMs: deadlineMs,
      display: request.display,
    };

    return await new Promise<ClientToolExecutionOutcome>((resolve) => {
      const pending: PendingCall = {
        requestId,
        capabilityId: request.capabilityId,
        deviceId: target.deviceId,
        connectionEpoch: target.connectionEpoch,
        sessionId: request.sessionId,
        runId: request.runId,
        toolCallId: request.toolCallId,
        issuedAtMs,
        deadlineAtMs,
        timer: setTimeout(() => {
          this.sendCancel(pending, 'deadline');
          this.settle(pending, {
            ok: false,
            reason: 'client-tool-timeout',
            retryable: true,
          });
        }, deadlineMs),
        abortHandler: () => {
          this.sendCancel(pending, 'run-aborted');
          this.settle(pending, { ok: false, reason: 'cancelled', retryable: false });
        },
        signal,
        resolve,
        settled: false,
      };
      this.pending.set(requestId, pending);
      signal.addEventListener('abort', pending.abortHandler, { once: true });
      this.logger({
        operation: 'request',
        capabilityId: request.capabilityId,
        requestId,
        deviceIdSuffix: suffix(target.deviceId),
        pending: this.pending.size,
      });
      try {
        target.send(frame);
      } catch {
        this.settle(pending, { ok: false, reason: 'client-device-disconnected', retryable: true });
      }
    });
  }

  public forgetDevice(deviceId: string): void {
    void this.registry.removeDevice(deviceId).catch(() => undefined);
    for (const [epoch, connection] of this.connections) {
      if (connection.deviceId === deviceId) {
        this.detach(epoch);
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    for (const pending of [...this.pending.values()]) {
      this.sendCancel(pending, 'host-shutdown');
      this.settle(pending, { ok: false, reason: 'cancelled', retryable: false });
    }
    this.connections.clear();
  }

  public async flush(): Promise<void> {
    await this.registry.flush();
  }

  private selectTarget(
    capabilityId: string,
    preferredDeviceId: string | undefined,
  ): AttachedConnection | undefined {
    const connected = [...this.connections.values()]
      .filter((connection) => connection.capabilityIds.has(capabilityId))
      .sort((left, right) => right.attachedAt - left.attachedAt);

    const primary = this.registry.primaryDevice(capabilityId);
    const orderedIds = [
      preferredDeviceId,
      primary,
      connected[0]?.deviceId,
      this.registry.mostRecentlyAdvertised(capabilityId),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    for (const deviceId of orderedIds) {
      const live = connected.find((connection) => connection.deviceId === deviceId);
      if (live !== undefined) {
        return live;
      }
    }
    return undefined;
  }

  private healthPendingFor(deviceId: string): number {
    let count = 0;
    for (const pending of this.pending.values()) {
      if (
        pending.deviceId === deviceId &&
        pending.capabilityId === APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID &&
        !pending.settled
      ) {
        count += 1;
      }
    }
    return count;
  }

  private sendCancel(pending: PendingCall, reason: ClientToolCancelReason): void {
    const connection = this.connections.get(pending.connectionEpoch);
    if (connection === undefined) {
      return;
    }
    try {
      connection.send({
        type: 'client-tool/cancel',
        requestId: pending.requestId,
        reason,
      });
      this.logger({
        operation: 'cancel',
        requestId: pending.requestId,
        status: reason,
        pending: this.pending.size,
      });
    } catch {
      // Best-effort cancel.
    }
  }

  private settle(pending: PendingCall, outcome: ClientToolExecutionOutcome): void {
    if (pending.settled) {
      return;
    }
    pending.settled = true;
    clearTimeout(pending.timer);
    pending.signal.removeEventListener('abort', pending.abortHandler);
    this.pending.delete(pending.requestId);
    this.logger({
      operation: 'result',
      requestId: pending.requestId,
      capabilityId: pending.capabilityId,
      deviceIdSuffix: suffix(pending.deviceId),
      status: outcome.ok ? 'success' : outcome.reason,
      durationMs: this.now() - pending.issuedAtMs,
      pending: this.pending.size,
    });
    pending.resolve(outcome);
  }
}

function mapResult(deviceId: string, frame: ClientToolResultFrame): ClientToolExecutionOutcome {
  if (frame.status === 'success') {
    if (frame.result === undefined) {
      return { ok: false, reason: 'invalid-client-result', retryable: false };
    }
    return {
      ok: true,
      deviceId,
      completedAt: frame.completedAt,
      result: frame.result,
    };
  }
  switch (frame.status) {
    case 'permission-denied':
      return { ok: false, reason: 'permission-denied', retryable: false };
    case 'user-presence-required':
      return { ok: false, reason: 'user-presence-required', retryable: true };
    case 'no-accessible-data':
      return { ok: false, reason: 'no-accessible-data', retryable: false };
    case 'cancelled':
      return { ok: false, reason: 'cancelled', retryable: false };
    case 'unavailable':
      return {
        ok: false,
        reason:
          frame.errorCode === 'deadline-expired' ? 'client-tool-timeout' : 'client-device-unavailable',
        retryable: true,
      };
    case 'failed':
      return { ok: false, reason: 'client-tool-failed', retryable: false };
  }
}

function clampDeadline(deadlineMs: number): number {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    return CLIENT_TOOL_DEFAULT_DEADLINE_MS;
  }
  return Math.min(Math.max(Math.trunc(deadlineMs), 1), CLIENT_TOOL_MAX_DEADLINE_MS);
}

function suffix(deviceId: string): string {
  return deviceId.length <= 8 ? deviceId : deviceId.slice(-8);
}
