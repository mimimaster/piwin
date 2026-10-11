/** Host-owned native agent terminal. Executable and working directory stay on the Host. */
export type AgentCliOpenInput = {
  agentId: 'grok';
  sessionId?: string;
  /** Local project path or opaque remote project id; ignored for a resumed session. */
  projectPath?: string;
  cols: number;
  rows: number;
};

export type AgentCliOpenData = { ptyId: string; sessionId: string };

export type AgentCliHostCommand =
  | { id?: string; type: 'agents/cli-open'; input: AgentCliOpenInput }
  /** Refresh the native history projection without closing interactive terminals. */
  | { id?: string; type: 'agents/cli-sync'; sessionId: string };

export const AGENT_CLI_MAX_INPUT_CHARS = 64 * 1024;

export function isValidTerminalSize(cols: unknown, rows: unknown): boolean {
  return typeof cols === 'number' && Number.isSafeInteger(cols) && cols >= 2 && cols <= 1000 &&
    typeof rows === 'number' && Number.isSafeInteger(rows) && rows >= 1 && rows <= 500;
}
