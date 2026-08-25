import type {
  ClientToolCancelFrame,
  ClientToolRequestFrame,
  ClientToolResultFrame,
} from '@piwin/contracts';
import {
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  CLIENT_TOOL_MAX_DEADLINE_MS,
} from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import {
  applyConsentDecision,
  healthConsentScopeKey,
  markSuccessfulExplicitRead,
  resolveForegroundGrant,
  type ClientToolPreferenceStore,
  type HealthConsentGrant,
} from './client-tool-preferences.js';
import {
  executeFakeHealthRead,
  isFakeHealthExecutorAllowed,
} from './fake-health-executor.js';
import {
  healthkitCancelRead,
  healthkitReadContext,
} from '../health/native-healthkit.js';

export type ClientToolExecutor = (request: ClientToolRequestFrame, signal: AbortSignal) => Promise<unknown>;

export type MobileClientToolConsentDecision = 'deny' | 'once' | 'session' | 'always';

export type MobileClientToolRuntimeOptions = {
  client: HostClient;
  endpoint: string;
  deviceId: string;
  preferences: ClientToolPreferenceStore;
  isAppActive: () => boolean;
  now?: () => number;
  production?: boolean;
  allowFakeHealth?: boolean;
  nativeHealthAvailable?: boolean;
  healthEnabled?: boolean;
  requestConsent?: (
    request: ClientToolRequestFrame,
  ) => Promise<MobileClientToolConsentDecision>;
  executors?: ReadonlyMap<string, ClientToolExecutor>;
};

/**
 * Allowlisted dispatcher for Host client-tool requests. Sends exactly one
 * result per request ID and ignores late executor settlement after cancel.
 */
export class MobileClientToolRuntime {
  private readonly client: HostClient;
  private readonly endpoint: string;
  private readonly deviceId: string;
  private readonly preferences: ClientToolPreferenceStore;
  private readonly isAppActive: () => boolean;
  private readonly now: () => number;
  private readonly production: boolean;
  private readonly allowFakeHealth: boolean;
  private readonly nativeHealthAvailable: boolean;
  private healthEnabled: boolean;
  private readonly requestConsent:
    | ((request: ClientToolRequestFrame) => Promise<MobileClientToolConsentDecision>)
    | undefined;
  private readonly executors: ReadonlyMap<string, ClientToolExecutor>;
  private readonly inFlight = new Map<
    string,
    { controller: AbortController; timeout: ReturnType<typeof setTimeout>; sent: boolean }
  >();
  private unsubscribers: Array<() => void> = [];
  private scopeKey: string | undefined;

  public constructor(options: MobileClientToolRuntimeOptions) {
    this.client = options.client;
    this.endpoint = options.endpoint;
    this.deviceId = options.deviceId;
    this.preferences = options.preferences;
    this.isAppActive = options.isAppActive;
    this.now = options.now ?? Date.now;
    this.production = options.production === true;
    this.allowFakeHealth = options.allowFakeHealth === true;
    this.nativeHealthAvailable = options.nativeHealthAvailable === true;
    this.healthEnabled = options.healthEnabled !== false;
    this.requestConsent = options.requestConsent;
    this.executors = options.executors ?? this.defaultExecutors();
  }

  public start(): void {
    this.unsubscribers.push(
      this.client.subscribeClientToolRequests((frame) => {
        void this.handleRequest(frame);
      }),
    );
    this.unsubscribers.push(
      this.client.subscribeClientToolCancellations((frame) => {
        this.handleCancel(frame);
      }),
    );
  }

  public stop(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
    for (const [requestId, pending] of this.inFlight) {
      pending.controller.abort();
      clearTimeout(pending.timeout);
      this.sendOnce(requestId, {
        type: 'client-tool/result',
        requestId,
        status: 'cancelled',
        completedAt: new Date(this.now()).toISOString(),
        errorCode: 'cancelled',
      });
    }
    this.inFlight.clear();
  }

  public setHealthEnabled(enabled: boolean): void {
    this.healthEnabled = enabled;
  }

  public advertisedCapabilities(): { id: string; version: number }[] {
    if (!this.shouldAdvertiseHealth()) {
      return [];
    }
    return [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }];
  }

  public async advertise(): Promise<void> {
    if (!this.client.supportsClientToolRequests()) {
      return;
    }
    this.client.replaceClientToolCapabilities(this.advertisedCapabilities());
  }

  private shouldAdvertiseHealth(): boolean {
    if (!this.healthEnabled || !this.client.supportsClientToolRequests()) {
      return false;
    }
    return this.executors.has(APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID);
  }

  private defaultExecutors(): ReadonlyMap<string, ClientToolExecutor> {
    const executors = new Map<string, ClientToolExecutor>();
    if (this.nativeHealthAvailable) {
      executors.set(APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, async (request, signal) => {
        const abort = (): void => {
          void healthkitCancelRead(request.requestId);
        };
        signal.addEventListener('abort', abort, { once: true });
        try {
          if (signal.aborted) {
            throw new Error('cancelled');
          }
          return await healthkitReadContext(request);
        } finally {
          signal.removeEventListener('abort', abort);
        }
      });
      return executors;
    }
    if (
      isFakeHealthExecutorAllowed({
        production: this.production,
        allowFake: this.allowFakeHealth,
      })
    ) {
      executors.set(APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, async (request, signal) => {
        if (signal.aborted) {
          throw new Error('cancelled');
        }
        return executeFakeHealthRead(request, () => new Date(this.now()));
      });
    }
    return executors;
  }

  private async handleRequest(request: ClientToolRequestFrame): Promise<void> {
    if (this.inFlight.has(request.requestId)) {
      return;
    }
    const timeoutMs = Math.min(Math.max(request.timeoutMs, 1), CLIENT_TOOL_MAX_DEADLINE_MS);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      this.finish(request.requestId, {
        type: 'client-tool/result',
        requestId: request.requestId,
        status: 'unavailable',
        completedAt: new Date(this.now()).toISOString(),
        errorCode: 'deadline-expired',
      });
    }, timeoutMs);
    this.inFlight.set(request.requestId, { controller, timeout, sent: false });

    try {
      const result = await this.execute(request, controller.signal);
      this.finish(request.requestId, result);
    } catch (error) {
      this.finish(request.requestId, mapExecutorFailure(request.requestId, error, this.now));
    }
  }

  private handleCancel(frame: ClientToolCancelFrame): void {
    const pending = this.inFlight.get(frame.requestId);
    if (pending === undefined) {
      return;
    }
    pending.controller.abort();
    this.finish(frame.requestId, {
      type: 'client-tool/result',
      requestId: frame.requestId,
      status: 'cancelled',
      completedAt: new Date(this.now()).toISOString(),
      errorCode: 'cancelled',
    });
  }

  private async execute(
    request: ClientToolRequestFrame,
    signal: AbortSignal,
  ): Promise<ClientToolResultFrame> {
    const completedAt = () => new Date(this.now()).toISOString();
    if (!this.isAppActive()) {
      return {
        type: 'client-tool/result',
        requestId: request.requestId,
        status: 'user-presence-required',
        completedAt: completedAt(),
        errorCode: 'user-presence-required',
      };
    }
    const executor = this.executors.get(request.capabilityId);
    if (!this.healthEnabled || executor === undefined) {
      return {
        type: 'client-tool/result',
        requestId: request.requestId,
        status: 'unavailable',
        completedAt: completedAt(),
        errorCode: 'healthkit-unavailable',
      };
    }
    const grant = await this.consentGrant(request);
    if (grant.mode === 'off') {
      return {
        type: 'client-tool/result',
        requestId: request.requestId,
        status: 'permission-denied',
        completedAt: completedAt(),
        errorCode: 'local-policy-denied',
      };
    }
    const sessionAllowed =
      grant.mode === 'allow-for-session' && grant.sessionId === request.sessionId;
    const hostAllowed = grant.mode === 'always-allow-this-host' && grant.alwaysAllowUnlocked;
    const providerKnown = request.display.provider !== undefined;
    const explicitTurn = request.display.explicitTurnIntent === true && providerKnown;
    if (!sessionAllowed && !hostAllowed && !explicitTurn) {
      const decision = this.requestConsent === undefined ? 'deny' : await this.requestConsent(request);
      if (signal.aborted) {
        return {
          type: 'client-tool/result',
          requestId: request.requestId,
          status: 'cancelled',
          completedAt: completedAt(),
          errorCode: 'cancelled',
        };
      }
      const next = applyConsentDecision(grant, decision, request.sessionId);
      await this.writeGrant(next);
      if (decision === 'deny') {
        return {
          type: 'client-tool/result',
          requestId: request.requestId,
          status: 'permission-denied',
          completedAt: completedAt(),
          errorCode: 'local-policy-denied',
        };
      }
    }
    const result = await executor(request, signal);
    if (signal.aborted) {
      return {
        type: 'client-tool/result',
        requestId: request.requestId,
        status: 'cancelled',
        completedAt: completedAt(),
        errorCode: 'cancelled',
      };
    }
    const successful = await this.readGrant();
    if (successful !== undefined) {
      await this.writeGrant(markSuccessfulExplicitRead(successful));
    }
    return {
      type: 'client-tool/result',
      requestId: request.requestId,
      status: 'success',
      completedAt: completedAt(),
      result: result as Record<string, unknown>,
    };
  }

  private async consentGrant(request: ClientToolRequestFrame): Promise<HealthConsentGrant> {
    const stored = await this.readGrant();
    const destinationFingerprint =
      request.display.provider === undefined
        ? undefined
        : `${request.display.provider.processing}:${request.display.provider.id}`;
    return resolveForegroundGrant(stored, {
      sessionId: request.sessionId,
      ...(destinationFingerprint === undefined ? {} : { destinationFingerprint }),
    });
  }

  private async readGrant(): Promise<HealthConsentGrant | undefined> {
    const key = await this.ensureScopeKey();
    return this.preferences.read(key);
  }

  private async writeGrant(grant: HealthConsentGrant): Promise<void> {
    const key = await this.ensureScopeKey();
    this.preferences.write(key, grant);
  }

  private async ensureScopeKey(): Promise<string> {
    if (this.scopeKey === undefined) {
      this.scopeKey = await healthConsentScopeKey(this.endpoint, this.deviceId);
    }
    return this.scopeKey;
  }

  private finish(requestId: string, frame: ClientToolResultFrame): void {
    const pending = this.inFlight.get(requestId);
    if (pending === undefined) {
      return;
    }
    clearTimeout(pending.timeout);
    this.inFlight.delete(requestId);
    this.sendOnce(requestId, frame, pending);
  }

  private sendOnce(
    requestId: string,
    frame: ClientToolResultFrame,
    pending?: { sent: boolean },
  ): void {
    if (pending?.sent === true) {
      return;
    }
    if (pending !== undefined) {
      pending.sent = true;
    }
    try {
      this.client.sendClientToolResult(frame);
    } catch {
      // Connection may have dropped; the Host deadline is the fallback.
    }
    void requestId;
  }
}

function mapExecutorFailure(
  requestId: string,
  error: unknown,
  now: () => number,
): ClientToolResultFrame {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('healthkit-no-accessible-data')) {
    return {
      type: 'client-tool/result',
      requestId,
      status: 'no-accessible-data',
      completedAt: new Date(now()).toISOString(),
      errorCode: 'healthkit-no-accessible-data',
    };
  }
  if (message.includes('cancelled')) {
    return {
      type: 'client-tool/result',
      requestId,
      status: 'cancelled',
      completedAt: new Date(now()).toISOString(),
      errorCode: 'cancelled',
    };
  }
  if (message.includes('healthkit-unavailable')) {
    return {
      type: 'client-tool/result',
      requestId,
      status: 'unavailable',
      completedAt: new Date(now()).toISOString(),
      errorCode: 'healthkit-unavailable',
    };
  }
  return {
    type: 'client-tool/result',
    requestId,
    status: 'failed',
    completedAt: new Date(now()).toISOString(),
    errorCode: 'healthkit-query-failed',
  };
}
