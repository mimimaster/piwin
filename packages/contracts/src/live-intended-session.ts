export type LiveSetIntendedSessionInput = {
  callId: string;
  /**
   * Focused work session. `null` means the owner has no focused session
   * (empty pane, new-agent draft, project with no session).
   */
  intendedSessionId: string | null;
};
