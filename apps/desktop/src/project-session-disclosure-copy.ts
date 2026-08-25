import type { DesktopLocale } from './desktop-locale';

export type ProjectSessionDisclosureCopy = {
  showMore: string;
  showMoreSessions: (count: number) => string;
};

/** Copy for the project-local progressive disclosure row. */
export function getProjectSessionDisclosureCopy(
  locale: DesktopLocale,
): ProjectSessionDisclosureCopy {
  if (locale === 'zh-CN') {
    return {
      showMore: '显示更多',
      showMoreSessions: (count) => `再显示 ${count} 个会话`,
    };
  }
  return {
    showMore: 'Show more',
    showMoreSessions: (count) => `Show ${count} more session${count === 1 ? '' : 's'}`,
  };
}
