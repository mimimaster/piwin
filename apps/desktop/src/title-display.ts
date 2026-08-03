/** Full string for titlebar hover tooltip (and a11y name). */
export function buildTitlebarTooltip(projectName: string | undefined, sessionName: string): string {
  const project = projectName?.trim() ?? '';
  const session = sessionName.trim();
  if (!project) return session;
  if (!session) return project;
  return `${project} / ${session}`;
}

// Single source of truth lives in @piwin/session (sidebar list policy).
export {
  isPlaceholderSessionName,
  sessionHasListName,
  filterListableSessions,
} from '@piwin/session/session-display-name';
