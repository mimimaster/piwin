import type { HostCommand, HostResponse } from '@piwin/contracts';
import { remoteCommandRequiresIdempotencyKey } from '@piwin/contracts';
import { createRemoteCommandDigest } from './remote-idempotency.js';

export const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 4_096;
export const DEFAULT_IDEMPOTENCY_MAX_RESPONSE_BYTES = 64 * 1024;
export const DEFAULT_IDEMPOTENCY_MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export type HostCommandIdempotencyAdmission =
  | { kind: 'bypass' }
  | { kind: 'missing-key' }
  | { kind: 'conflict' }
  | { kind: 'capacity' }
  | { kind: 'replay'; response: HostResponse }
  | { kind: 'join'; result: Promise<HostResponse> }
  | { kind: 'execute'; cacheKey: string; digest: string };

export type HostCommandIdempotencyStats = {
  inFlight: number;
  completed: number;
  storedBytes: number;
  replayCount: number;
  conflictCount: number;
  capacityCount: number;
};

type CompletedEntry = {
  digest: string;
  storedBytes: number;
  response: HostResponse | undefined;
};

/**
 * Process-lifetime mutation identity. One registry per Host instance.
 * Completed keys are never silently evicted.
 */
export class HostCommandIdempotencyRegistry {
  private readonly maxEntries: number;
  private readonly maxResponseBytes: number;
  private readonly maxTotalBytes: number;
  private readonly completed = new Map<string, CompletedEntry>();
  private readonly inFlight = new Map<string, { digest: string; result: Promise<HostResponse> }>();
  private storedBytes = 0;
  private replayCount = 0;
  private conflictCount = 0;
  private capacityCount = 0;

  public constructor(options?: {
    maxEntries?: number;
    maxResponseBytes?: number;
    maxTotalBytes?: number;
  }) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_IDEMPOTENCY_MAX_ENTRIES;
    this.maxResponseBytes = options?.maxResponseBytes ?? DEFAULT_IDEMPOTENCY_MAX_RESPONSE_BYTES;
    this.maxTotalBytes = options?.maxTotalBytes ?? DEFAULT_IDEMPOTENCY_MAX_TOTAL_BYTES;
  }

  public admit(
    principalId: string,
    idempotencyKey: string | undefined,
    command: HostCommand,
  ): HostCommandIdempotencyAdmission {
    const requiresKey = remoteCommandRequiresIdempotencyKey(command.type);
    const key = idempotencyKey?.trim() ?? '';
    if (requiresKey && key.length === 0) {
      return { kind: 'missing-key' };
    }
    if (key.length === 0) {
      return { kind: 'bypass' };
    }
    const cacheKey = `${principalId}:${key}`;
    const digest = createRemoteCommandDigest(command);
    const done = this.completed.get(cacheKey);
    if (done !== undefined) {
      if (done.digest !== digest) {
        this.conflictCount += 1;
        return { kind: 'conflict' };
      }
      this.replayCount += 1;
      if (done.response === undefined) {
        return {
          kind: 'replay',
          response: {
            type: 'response',
            command: command.type,
            success: true,
          },
        };
      }
      return { kind: 'replay', response: done.response };
    }
    const pending = this.inFlight.get(cacheKey);
    if (pending !== undefined) {
      if (pending.digest !== digest) {
        this.conflictCount += 1;
        return { kind: 'conflict' };
      }
      this.replayCount += 1;
      return { kind: 'join', result: pending.result };
    }
    if (this.completed.size + this.inFlight.size >= this.maxEntries) {
      this.capacityCount += 1;
      return { kind: 'capacity' };
    }
    return { kind: 'execute', cacheKey, digest };
  }

  public begin(cacheKey: string, digest: string, result: Promise<HostResponse>): void {
    this.inFlight.set(cacheKey, { digest, result });
  }

  public complete(cacheKey: string, digest: string, response: HostResponse): void {
    this.inFlight.delete(cacheKey);
    const storable = this.toStorableResponse(response);
    const storedBytes = storable === undefined ? 0 : encodedBytes(storable);
    this.completed.set(cacheKey, { digest, storedBytes, response: storable });
    this.storedBytes += storedBytes;
  }

  public fail(cacheKey: string): void {
    this.inFlight.delete(cacheKey);
  }

  public getStats(): HostCommandIdempotencyStats {
    return {
      inFlight: this.inFlight.size,
      completed: this.completed.size,
      storedBytes: this.storedBytes,
      replayCount: this.replayCount,
      conflictCount: this.conflictCount,
      capacityCount: this.capacityCount,
    };
  }

  public dispose(): void {
    this.completed.clear();
    this.inFlight.clear();
    this.storedBytes = 0;
  }

  private toStorableResponse(response: HostResponse): HostResponse | undefined {
    if (containsPathBearingValue(response)) {
      return undefined;
    }
    const encoded = encodedBytes(response);
    if (encoded > this.maxResponseBytes || this.storedBytes + encoded > this.maxTotalBytes) {
      return undefined;
    }
    return response;
  }
}

export async function admitAndExecuteHostCommand(input: {
  registry: HostCommandIdempotencyRegistry;
  principalId: string;
  idempotencyKey: string | undefined;
  command: HostCommand;
  execute: () => Promise<HostResponse>;
}): Promise<HostResponse> {
  const admission = input.registry.admit(input.principalId, input.idempotencyKey, input.command);
  switch (admission.kind) {
    case 'bypass':
      return input.execute();
    case 'missing-key':
      return {
        type: 'response',
        command: input.command.type,
        success: false,
        error: 'idempotency-key-required',
        problem: { code: 'idempotency-key-required' },
      };
    case 'conflict':
      return {
        type: 'response',
        command: input.command.type,
        success: false,
        error: 'idempotency-conflict',
        problem: { code: 'idempotency-conflict' },
      };
    case 'capacity':
      return {
        type: 'response',
        command: input.command.type,
        success: false,
        error: 'idempotency-registry-capacity',
        problem: { code: 'idempotency-registry-capacity' },
      };
    case 'replay':
      return admission.response;
    case 'join':
      return admission.result;
    case 'execute': {
      const pending = input.execute();
      input.registry.begin(admission.cacheKey, admission.digest, pending);
      try {
        const response = await pending;
        input.registry.complete(admission.cacheKey, admission.digest, response);
        return response;
      } catch (error) {
        input.registry.fail(admission.cacheKey);
        throw error;
      }
    }
  }
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function containsPathBearingValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsPathBearingValue(entry));
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (
      (key === 'absolutePath' || key === 'piwinRoot' || key === 'cwd') &&
      typeof nested === 'string' &&
      nested.length > 0
    ) {
      return true;
    }
    if (containsPathBearingValue(nested)) {
      return true;
    }
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
