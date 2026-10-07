import type { HostHelloRejectReason } from '@piwin/contracts';

/**
 * The Host answered the hello with a refusal. `reason` is absent when the Host
 * predates reject reasons; callers then fall back to `message`.
 */
export class HostHandshakeError extends Error {
  public readonly name = 'HostHandshakeError';
  public readonly closeCode: number;
  public readonly reason: HostHelloRejectReason | undefined;

  public constructor(message: string, closeCode: number, reason?: HostHelloRejectReason) {
    super(message);
    this.closeCode = closeCode;
    this.reason = reason;
  }
}
