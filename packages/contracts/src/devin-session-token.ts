/**
 * Devin (Windsurf) API clients authenticate with `devin-session-token$<jwt>`.
 * The OAuth exchange (`POST /auth/cli/token`) returns only the JWT part, so
 * every Windsurf-protocol caller that reuses the Devin sign-in must add the
 * prefix. Pure and idempotent: an already prefixed token is returned as is.
 */
export const DEVIN_SESSION_TOKEN_PREFIX = 'devin-session-token$';

export function toDevinSessionToken(token: string): string {
  return token.startsWith(DEVIN_SESSION_TOKEN_PREFIX) ? token : `${DEVIN_SESSION_TOKEN_PREFIX}${token}`;
}
