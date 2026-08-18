/**
 * How a remote or multi-client shell admits a foreground prompt when the
 * session may already have a run in flight.
 *
 * - `if-idle`: only accept when no foreground run is active
 * - `replace-run`: cancel/replace the named run and admit the new prompt
 *
 * Local JSONL may omit `foreground`; queued-turn / `session/replace-run`
 * already cover single-shell interruption. Remote Hosts must send this field.
 */
export type PromptForegroundAdmission =
  | { kind: 'if-idle' }
  | { kind: 'replace-run'; runId: string };
