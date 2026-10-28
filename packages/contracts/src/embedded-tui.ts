import { AGENT_CLI_MAX_PROJECT_PATH_CHARS, isValidTerminalSize } from './agent-cli.js';
import type { HostAttachTarget } from './host-attach-target.js';

/** Desktop's native PTY launch; absent remoteTarget means its own sidecar. */
export type EmbeddedTuiLaunch = {
  sessionId?: string;
  projectPath?: string;
  projectId?: string;
  remoteTarget?: HostAttachTarget;
};

/**
 * An embedded TUI tells the terminal emulator around it which session it now
 * shows, as an OSC 777 string only that emulator reads (`piwin;session;<id>`).
 * Desktop follows it, so a conversation started in the terminal becomes the
 * conversation Desktop has open. Other terminals ignore unknown OSC strings.
 */
/** The OSC number the announcement travels under. */
export const TUI_SESSION_OSC = 777;
const PREFIX = 'piwin;session;';

export function formatTuiSessionAnnouncement(sessionId: string): string {
  // The id rides inside an escape sequence: anything that could end it early is dropped.
  const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '');
  return `\x1b]${TUI_SESSION_OSC};${PREFIX}${safe}\x07`;
}

/** The session id in an OSC 777 payload (what follows `777;`), or undefined for any other 777 string. */
export function parseTuiSessionAnnouncement(payload: string): string | undefined {
  if (!payload.startsWith(PREFIX)) return undefined;
  const sessionId = payload.slice(PREFIX.length);
  return /^[A-Za-z0-9._-]+$/.test(sessionId) ? sessionId : undefined;
}

/**
 * Host-run terminal shell (ADR 0102). Shells that cannot open a terminal
 * themselves (the phone, a browser) ask the Host to start `piwin tui
 * --embedded` in a terminal on its own machine and stream it like a native
 * agent CLI (`pty/output`, `pty/write`, `pty/resize`, `pty/close`).
 * The client names only a session or project and a grid size: program,
 * arguments, environment and working directory stay on the Host.
 */
export type EmbeddedTuiOpenInput = {
  /** Absent: a new conversation, created by the first message. */
  sessionId?: string;
  /** Local project path or opaque remote project id; ignored once a session is named. */
  projectPath?: string;
  cols: number;
  rows: number;
};

export type EmbeddedTuiOpenData = {
  ptyId: string;
  /** True when the Host handed back a running terminal instead of starting one. */
  reattached?: boolean;
};

export type EmbeddedTuiHostCommand = { id?: string; type: 'tui/open'; input: EmbeddedTuiOpenInput };

const EMBEDDED_TUI_OPEN_KEYS = ['sessionId', 'projectPath', 'cols', 'rows'] as const;

/** Same rule as the native launcher: a session id becomes a CLI argument. */
export function isSafeTuiSessionId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !value.startsWith('-') && /^[A-Za-z0-9._:-]+$/.test(value);
}

/** Syntactic gate only; the Host still binds the project and checks trust. */
export function isEmbeddedTuiOpenInput(value: unknown): value is EmbeddedTuiOpenInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => (EMBEDDED_TUI_OPEN_KEYS as readonly string[]).includes(key))) {
    return false;
  }
  if (!isValidTerminalSize(record.cols, record.rows)) return false;
  if (record.sessionId !== undefined && !isSafeTuiSessionId(record.sessionId)) return false;
  const projectPath = record.projectPath;
  return projectPath === undefined || (
    typeof projectPath === 'string' && projectPath.length > 0 &&
    projectPath.length <= AGENT_CLI_MAX_PROJECT_PATH_CHARS && !projectPath.includes('\0')
  );
}
