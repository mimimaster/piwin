import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_TOKEN_LENGTH = 16;

/**
 * Self-enrollment secret (`PIWIN_RELAY_ENROLL_TOKEN`, ADR 0101 §3). Comparison
 * hashes both sides first so the timing does not depend on length or prefix.
 * The token is never logged.
 */
export class RelayEnrollToken {
  private readonly digest: Buffer;

  private constructor(token: string) {
    this.digest = sha256(token);
  }

  /** Undefined when unset; throws on a token too short to be a secret. */
  public static fromEnvironment(value: string | undefined): RelayEnrollToken | undefined {
    const token = value?.trim();
    if (token === undefined || token.length === 0) {
      return undefined;
    }
    if (token.length < MIN_TOKEN_LENGTH) {
      throw new Error(`PIWIN_RELAY_ENROLL_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
    }
    return new RelayEnrollToken(token);
  }

  public matches(candidate: string | undefined): boolean {
    if (candidate === undefined) {
      return false;
    }
    return timingSafeEqual(this.digest, sha256(candidate));
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
