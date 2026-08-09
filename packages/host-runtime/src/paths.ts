import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Rejects id segments that could escape their intended directory via path
 * traversal. Walkthrough artifacts are keyed by `sessionId + messageId`; both
 * must be single path segments with no separators, parent references, or NUL
 * bytes. Throws so callers cannot silently persist a traversal payload.
 */
function assertSafePathSegment(id: string, label: string): void {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Invalid ${label}: must be a non-empty string`);
  }
  if (id === '.' || id === '..') {
    throw new Error(`Invalid ${label}: path segment must not be "." or ".."`);
  }
  if (id.includes('/') || id.includes('\\')) {
    throw new Error(`Invalid ${label}: path segment must not contain separators`);
  }
  if (id.includes('\0')) {
    throw new Error(`Invalid ${label}: path segment must not contain NUL bytes`);
  }
}

/**
 * Encodes a messageId into a filesystem-safe filename component. base64url
 * produces URL/filename-safe characters (no `/`, `+`, or `=`) and is stable for
 * a given input. Decoding is not required — we only need a unique, collision-free
 * mapping from messageId to filename.
 */
function encodeMessageIdForFilename(messageId: string): string {
  return Buffer.from(messageId, 'utf8').toString('base64url');
}

export function getPiwinRoot(override?: string): string {
  if (override && override.trim().length > 0) {
    return override;
  }
  const fromEnv = process.env.PIWIN_ROOT;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return join(homedir(), '.piwin');
}

export function getPiwinConfigPath(rootDir: string): string {
  return join(rootDir, 'config.json');
}

export function getPiwinMediaDir(rootDir: string): string {
  return join(rootDir, 'media');
}

/**
 * Per-session media vault (`~/.piwin/media/<sessionId>/`).
 * Must stay under {@link getPiwinMediaDir}; deleted with permanent session delete.
 */
export function getPiwinSessionMediaDir(rootDir: string, sessionId: string): string {
  return join(getPiwinMediaDir(rootDir), sessionId);
}

/** Product-owned General session workspace (not a user project root). */
export function getPiwinGeneralWorkspacePath(rootDir: string): string {
  return join(rootDir, 'workspace');
}

export function getPiwinLogsDir(rootDir: string): string {
  return join(rootDir, 'logs');
}

export function getPiwinSessionsIndexDir(rootDir: string): string {
  return join(rootDir, 'sessions-index');
}

export function getPiwinProjectsPath(rootDir: string): string {
  return join(rootDir, 'projects.json');
}

export function getPiwinSessionIndexPath(rootDir: string): string {
  return join(rootDir, 'sessions-index', 'index.json');
}

export function getPiwinMcpConfigPath(rootDir: string): string {
  return join(rootDir, 'mcp.json');
}

export function getPiwinSkillsDir(rootDir: string): string {
  return join(rootDir, 'skills');
}

export function getPiwinExtensionsDir(rootDir: string): string {
  return join(rootDir, 'extensions');
}

export function getPiwinPromptsDir(rootDir: string): string {
  return join(rootDir, 'prompts');
}

export function getPiwinSessionsDir(rootDir: string): string {
  return join(rootDir, 'sessions');
}

export function getPiwinSessionDir(rootDir: string, sessionId: string): string {
  return join(getPiwinSessionsDir(rootDir), sessionId);
}

export function getPiwinSessionTranscriptPath(rootDir: string, sessionId: string): string {
  return join(getPiwinSessionDir(rootDir, sessionId), 'transcript.json');
}

/** ADR 0040 product-authoritative bounded transcript database. */
export function getPiwinSessionTranscriptDatabasePath(rootDir: string, sessionId: string): string {
  return join(getPiwinSessionDir(rootDir, sessionId), 'transcript.sqlite3');
}

/** Retained lossless v1 source used by doctor/recovery after migration. */
export function getPiwinSessionTranscriptBackupPath(rootDir: string, sessionId: string): string {
  return join(getPiwinSessionDir(rootDir, sessionId), 'transcript.json.v1.bak');
}

export function getPiwinSessionPlanPath(rootDir: string, sessionId: string): string {
  return join(getPiwinSessionDir(rootDir, sessionId), 'plan.json');
}

/**
 * Directory holding persisted Walkthrough artifacts for a session
 * (spec §7.2): `~/.piwin/sessions/<sessionId>/walkthroughs/`. Validates
 * `sessionId` so it cannot escape the session directory via path traversal.
 */
export function getPiwinSessionWalkthroughDir(rootDir: string, sessionId: string): string {
  assertSafePathSegment(sessionId, 'sessionId');
  return join(getPiwinSessionDir(rootDir, sessionId), 'walkthroughs');
}

/**
 * Path to a single persisted Walkthrough artifact JSON file. The messageId is
 * base64url-encoded so any character is filesystem-safe while remaining a
 * unique mapping back to the source message (spec §7.2). Both `sessionId` and
 * `messageId` are validated against path traversal.
 */
export function getPiwinSessionWalkthroughPath(
  rootDir: string,
  sessionId: string,
  messageId: string,
): string {
  assertSafePathSegment(sessionId, 'sessionId');
  assertSafePathSegment(messageId, 'messageId');
  return join(
    getPiwinSessionWalkthroughDir(rootDir, sessionId),
    `${encodeMessageIdForFilename(messageId)}.json`,
  );
}

/**
 * Path to a Walkthrough Markdown file that mirrors the JSON artifact content.
 * Written alongside the JSON when the artifact reaches `ready` status so users
 * and external tools can read the walkthrough as a plain `.md` file (aligning
 * with Google Antigravity's `walkthrough.md` Artifact pattern). Both `sessionId`
 * and `messageId` are validated against path traversal.
 */
export function getPiwinSessionWalkthroughMdPath(
  rootDir: string,
  sessionId: string,
  messageId: string,
): string {
  assertSafePathSegment(sessionId, 'sessionId');
  assertSafePathSegment(messageId, 'messageId');
  return join(
    getPiwinSessionWalkthroughDir(rootDir, sessionId),
    `${encodeMessageIdForFilename(messageId)}.md`,
  );
}

/** CE-OBS: append-only usage ledger (JSONL) under the product root. */
export function getPiwinUsageLedgerPath(rootDir: string): string {
  return join(rootDir, 'usage', 'ledger.jsonl');
}
