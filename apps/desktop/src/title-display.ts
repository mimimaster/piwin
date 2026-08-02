/** Full string for titlebar hover tooltip (and a11y name). */
export function buildTitlebarTooltip(projectName: string | undefined, sessionName: string): string {
  const project = projectName?.trim() ?? '';
  const session = sessionName.trim();
  if (!project) return session;
  if (!session) return project;
  return `${project} / ${session}`;
}

const PLACEHOLDER_SESSION_RE = /^session-[0-9a-f]{6,}$/i;

/** True when the list label is still a host placeholder, not user/auto content. */
export function isPlaceholderSessionName(name: string | undefined): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  return PLACEHOLDER_SESSION_RE.test(trimmed) || trimmed === 'New chat' || trimmed === '新会话';
}
