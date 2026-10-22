/**
 * The fixed place for app-level notices: a strip at the bottom of the
 * sidebar, right above Settings. Each source is a hook that returns its
 * notice while its condition holds; add new sources to `useSidebarNotices`.
 * Renders nothing (no reserved space) when there is no notice.
 */
import type { ReactElement } from 'react';
import { Button, Notice, ProgressBar } from '@piwin/ui-kit';
import { useAppUpdateNotice } from './app-update-notice.js';
import type { DesktopLocale } from './desktop-locale.js';
import type { SidebarNotice } from './sidebar-notice.js';

export function useSidebarNotices(locale: DesktopLocale): SidebarNotice[] {
  const appUpdate = useAppUpdateNotice(locale);
  return appUpdate ? [appUpdate] : [];
}

function SidebarNoticeCard({ notice }: { notice: SidebarNotice }): ReactElement {
  const { primaryAction, secondaryAction } = notice;
  const hasActions = primaryAction !== undefined || secondaryAction !== undefined;
  return (
    <Notice
      tone={notice.tone}
      title={notice.title}
      testId={`sidebar-notice-${notice.id}`}
      {...(notice.message ? { children: notice.message } : {})}
      {...(notice.progress !== undefined
        ? {
            details: (
              <ProgressBar
                value={notice.progress ?? undefined}
                label={notice.message}
                testId={`sidebar-notice-${notice.id}-progress`}
              />
            ),
          }
        : {})}
      {...(hasActions
        ? {
            action: (
              <>
                {secondaryAction ? (
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={secondaryAction.disabled}
                    onClick={secondaryAction.onSelect}
                  >
                    {secondaryAction.label}
                  </Button>
                ) : null}
                {primaryAction ? (
                  <Button
                    variant="primary"
                    size="compact"
                    disabled={primaryAction.disabled}
                    onClick={primaryAction.onSelect}
                    data-testid={`sidebar-notice-${notice.id}-action`}
                  >
                    {primaryAction.label}
                  </Button>
                ) : null}
              </>
            ),
          }
        : {})}
    />
  );
}

export function SidebarNoticeArea({ locale }: { locale: DesktopLocale }): ReactElement | null {
  const notices = useSidebarNotices(locale);
  if (notices.length === 0) return null;
  return (
    <section className="sidebar-notices" data-testid="sidebar-notices" aria-live="polite">
      {notices.map((notice) => (
        <SidebarNoticeCard key={notice.id} notice={notice} />
      ))}
    </section>
  );
}
