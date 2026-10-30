/**
 * Opt-in permission diagnostics (`PIWIN_PERM_DIAG=1`). Used to find out why a
 * YOLO session still prompts: logs the inputs and result of every mode
 * resolution and every external-agent permission request. Off by default;
 * never logs prompt bodies beyond the action name.
 */
export function permissionDiagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PIWIN_PERM_DIAG === '1';
}

export function logPermissionDiagnostic(
  event: string,
  fields: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
  sink: (line: string) => void = (line) => console.error(line),
): void {
  if (!permissionDiagnosticsEnabled(env)) return;
  sink(`[perm-diag] ${event} ${JSON.stringify(fields)}`);
}
