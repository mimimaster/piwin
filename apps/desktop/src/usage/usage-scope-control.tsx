/**
 * Which ledger rows the usage page counts. Settings can be opened from inside
 * a project, so the scope is an explicit, visible choice: the page never
 * silently narrows to the open project.
 */
import type { ReactElement } from 'react';
import { SegmentedControl } from '@piwin/ui-kit';

export type UsageScopeChoice = 'all' | 'project';

/** The project filter to send, or null for every project. */
export function resolveUsageScopeProjectPath(
  choice: UsageScopeChoice,
  projectPath: string | null | undefined,
): string | null {
  return choice === 'project' && projectPath ? projectPath : null;
}

function projectLabel(projectPath: string): string {
  const parts = projectPath.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? projectPath;
}

export function UsageScopeControl({ value, projectPath, isZh, onChange }: {
  value: UsageScopeChoice;
  projectPath: string;
  isZh: boolean;
  onChange: (value: UsageScopeChoice) => void;
}): ReactElement {
  return (
    <SegmentedControl
      value={value}
      onChange={(next) => onChange(next === 'project' ? 'project' : 'all')}
      data={[
        { value: 'all', label: isZh ? '全部项目' : 'All projects' },
        {
          value: 'project',
          label: <span title={projectPath}>{projectLabel(projectPath)}</span>,
        },
      ]}
      aria-label={isZh ? '统计范围' : 'Usage scope'}
      testId="usage-scope-control"
    />
  );
}
