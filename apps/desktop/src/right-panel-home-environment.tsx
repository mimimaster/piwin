/**
 * Environment block atop the empty right panel: Host, project folder, branch.
 */

import { type ReactElement } from 'react';
import { IconFolder, IconGit, IconLaptop, IconServer } from './shell-icons';
import type { DesktopLocale } from './desktop-locale';
import type { RightPanelHomeContext } from './right-panel-home-context';

export type RightPanelHomeEnvironmentProps = {
  locale: DesktopLocale;
  context: RightPanelHomeContext;
  branch: string | null;
};

export function RightPanelHomeEnvironment(props: RightPanelHomeEnvironmentProps): ReactElement {
  const { host, project } = props.context;
  return (
    <section
      className="right-panel-home-env"
      data-testid="right-panel-home-env"
      aria-label={props.locale === 'zh-CN' ? '环境' : 'Environment'}
    >
      <div className="right-panel-home-env-title">
        {props.locale === 'zh-CN' ? '环境' : 'Environment'}
      </div>
      <div className="right-panel-home-env-row" data-testid="right-panel-home-env-host" title={host.label}>
        <span className="right-panel-home-icon" aria-hidden>
          {host.remote ? <IconServer /> : <IconLaptop />}
        </span>
        <span className="right-panel-home-env-text">{host.label}</span>
      </div>
      {project ? (
        <div
          className="right-panel-home-env-row"
          data-testid="right-panel-home-env-project"
          title={project.parentPath ? `${project.parentPath}/${project.name}` : project.name}
        >
          <span className="right-panel-home-icon" aria-hidden>
            <IconFolder />
          </span>
          <span className="right-panel-home-env-text">{project.name}</span>
          {project.parentPath ? (
            <span className="right-panel-home-env-muted">{project.parentPath}</span>
          ) : null}
        </div>
      ) : null}
      {props.branch ? (
        <div className="right-panel-home-env-row" data-testid="right-panel-home-env-branch" title={props.branch}>
          <span className="right-panel-home-icon" aria-hidden>
            <IconGit />
          </span>
          <span className="right-panel-home-env-text">{props.branch}</span>
        </div>
      ) : null}
    </section>
  );
}
