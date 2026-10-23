/**
 * Working-tree size next to the project and branch chips.
 * Host, folder, and branch already live on this row; this is only the
 * line count the main chrome did not show.
 */
import type { ReactElement } from 'react';
import type { HostResponse } from '@piwin/contracts';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { useWorkingTreeStat, type WorkingTreeStatRequest } from '../hooks/use-working-tree-stat';

export type { WorkingTreeStatRequest } from '../hooks/use-working-tree-stat';

export function SessionWorkingTreeChip(props: {
  projectPath: string;
  request: (command: WorkingTreeStatRequest) => Promise<HostResponse>;
  onOpen?: () => void;
}): ReactElement | null {
  const { locale } = useDesktopLocale();
  const stat = useWorkingTreeStat(props.projectPath, props.request);
  if (!stat) return null;
  const label = locale === 'zh-CN' ? '工作区变更' : 'Working tree changes';
  return (
    <button
      type="button"
      className="session-working-tree"
      data-testid="session-working-tree"
      title={label}
      aria-label={label}
      onClick={() => props.onOpen?.()}
    >
      <span className="session-working-tree-add">+{stat.additions}</span>
      <span className="session-working-tree-del">−{stat.deletions}</span>
    </button>
  );
}
