/**
 * Logical plan path used by the transcript and the document rail.
 * The durable file is `~/.piwin/sessions/<id>/plan.json`; this path is not
 * a workspace file and must never be opened with project/read-file.
 */
export function sessionPlanDisplayPath(sessionId: string): string {
  return `plans/${sessionId}.md`;
}

export function isSessionPlanDisplayPath(path: string, sessionId: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^file:\/\//, '').trim();
  return normalized === sessionPlanDisplayPath(sessionId);
}
