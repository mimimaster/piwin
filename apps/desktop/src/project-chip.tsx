/** Recent-project switcher anchored to the project path above the composer. */
import type { ProjectRecord } from '@piwin/contracts';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@piwin/ui-kit';
import type { ReactElement } from 'react';
import { getDesktopCopy } from './desktop-locale';
import { useDesktopLocale } from './desktop-locale-context';
import { projectDisplayName } from './project-display-name';
import { IconCheck, IconChevronDown, IconFolder } from './shell-icons';

export type ProjectChipProps = {
  projectPath: string;
  recentProjects: readonly ProjectRecord[];
  onOpenProject: (path: string) => void;
};

export function ProjectChip(props: ProjectChipProps): ReactElement {
  const { locale } = useDesktopLocale();
  const copy = getDesktopCopy(locale).sidebar;

  return (
    <DropdownMenu
      modal={false}
      align="start"
      side="bottom"
      contentClassName="project-picker-menu"
      testId="composer-project-menu"
      label={copy.recentProjects}
      trigger={
        <button
          type="button"
          className="composer-context-link"
          data-testid="composer-project-chip"
          title={props.projectPath}
          aria-label={`${copy.recentProjects}: ${props.projectPath}`}
        >
          <span className="composer-context-link-label">{props.projectPath}</span>
          <span className="composer-context-link-caret" aria-hidden>
            <IconChevronDown width={13} height={13} />
          </span>
        </button>
      }
    >
      <DropdownMenuLabel className="project-picker-menu-title">
        {copy.recentProjects}
      </DropdownMenuLabel>

      {props.recentProjects.length > 0 ? (
        props.recentProjects.map((project, index) => {
          const active = project.path === props.projectPath;
          const displayName = project.displayName ?? projectDisplayName(project.path);
          return (
            <DropdownMenuItem
              key={project.path}
              testId={`composer-project-item-${index}`}
              onSelect={() => {
                if (!active) {
                  props.onOpenProject(project.path);
                }
              }}
            >
              <span
                className={`project-picker-menu-item${active ? ' is-active' : ''}`}
                data-project-path={project.path}
              >
                <IconFolder
                  className="project-picker-menu-icon"
                  width={15}
                  height={15}
                  aria-hidden
                />
                <span className="project-picker-menu-item-body">
                  <span className="project-picker-menu-item-name">{displayName}</span>
                  <span className="project-picker-menu-item-path">{project.path}</span>
                </span>
                {active ? (
                  <IconCheck
                    className="project-picker-menu-check"
                    width={14}
                    height={14}
                    aria-hidden
                  />
                ) : null}
              </span>
            </DropdownMenuItem>
          );
        })
      ) : (
        <DropdownMenuLabel>{copy.noRecentProjects}</DropdownMenuLabel>
      )}
    </DropdownMenu>
  );
}
