/** Searchable project switcher used by the sidebar's "view all" action. */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { ProjectRecord } from '@piwin/contracts';
import { Button, Dialog, Field, ListRow } from '@piwin/ui-kit';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';
import { projectDisplayName } from './project-display-name';
import { IconCheck, IconFolder } from './shell-icons';

export type ProjectPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectRecord[];
  activeProjectPath: string | null;
  onOpenProject: (path: string) => void;
  locale?: DesktopLocale;
};

export function ProjectPickerDialog(props: ProjectPickerDialogProps): ReactElement {
  const sidebarCopy = getDesktopCopy(props.locale ?? 'zh-CN').sidebar;
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!props.open) {
      setQuery('');
    }
  }, [props.open]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
      return props.projects;
    }

    return props.projects.filter((project) => {
      const name = project.displayName ?? projectDisplayName(project.path);
      return [name, project.path].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      );
    });
  }, [props.projects, query]);

  return (
    <Dialog
      label={sidebarCopy.allProjects}
      open={props.open}
      onOpenChange={props.onOpenChange}
      testId="project-picker-dialog"
      contentClassName="project-picker-dialog"
      closeOnInteractOutside
    >
      <div className="project-picker-header">
        <div>
          <h3>{sidebarCopy.allProjects}</h3>
          <p className="muted">{sidebarCopy.projectPickerDescription}</p>
        </div>
        <Button
          variant="ghost"
          size="compact"
          data-testid="project-picker-close-btn"
          onClick={() => props.onOpenChange(false)}
        >
          {getDesktopCopy(props.locale ?? 'zh-CN').close}
        </Button>
      </div>

      <Field label={sidebarCopy.searchProjects}>
        <input
          data-testid="project-picker-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={sidebarCopy.searchProjects}
          autoFocus
          spellCheck={false}
        />
      </Field>

      <ul className="project-picker-list" data-testid="project-picker-list">
        {filteredProjects.length > 0 ? (
          filteredProjects.map((project) => {
            const name = project.displayName ?? projectDisplayName(project.path);
            const isActive = project.path === props.activeProjectPath;
            return (
              <li key={project.path}>
                <ListRow
                  className="project-picker-item"
                  selected={isActive}
                  compact
                  data-project-path={project.path}
                  onClick={() => {
                    props.onOpenProject(project.path);
                    props.onOpenChange(false);
                  }}
                >
                  <IconFolder width={16} height={16} aria-hidden />
                  <span className="project-picker-item-body">
                    <span className="project-picker-item-name">{name}</span>
                    <span className="project-picker-item-path">{project.path}</span>
                  </span>
                  {isActive ? (
                    <IconCheck
                      className="project-picker-item-check"
                      width={15}
                      height={15}
                      aria-hidden
                    />
                  ) : null}
                </ListRow>
              </li>
            );
          })
        ) : (
          <li className="project-picker-empty muted">{sidebarCopy.noMatchingProjects}</li>
        )}
      </ul>
    </Dialog>
  );
}
