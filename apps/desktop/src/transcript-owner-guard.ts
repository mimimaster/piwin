/**
 * Duplicate / fork / retry must not run against a transcript that still
 * belongs to another session (cold restore). Owner null means the active
 * transcript was cleared with the session and is safe to mutate.
 */
export function transcriptOwnerBlocksDangerousAction(input: {
  transcriptOwnerSessionId: string | null;
  activeSessionId: string | null;
}): boolean {
  return (
    input.transcriptOwnerSessionId !== null &&
    input.transcriptOwnerSessionId !== input.activeSessionId
  );
}
