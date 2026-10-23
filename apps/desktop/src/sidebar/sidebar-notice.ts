/**
 * One entry in the sidebar notice area (above Settings). A notice stays as
 * long as its source still returns it: there is no dismiss-and-forget queue,
 * so a resident notice like "update available" leaves only when the condition
 * that raised it is gone.
 */
export type SidebarNoticeTone = 'info' | 'warning' | 'error';

export type SidebarNoticeAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

export type SidebarNotice = {
  /** Stable per source; used as the React key and test id suffix. */
  id: string;
  tone: SidebarNoticeTone;
  title: string;
  message?: string;
  /** 0–100, or null while running with an unknown size. Absent: no bar. */
  progress?: number | null;
  primaryAction?: SidebarNoticeAction;
  secondaryAction?: SidebarNoticeAction;
};
