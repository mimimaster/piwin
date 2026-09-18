/**
 * Destination picker for the session menu's "Continue in project…" action.
 *
 * A session belongs to exactly one workspace, so continuing means copying the
 * transcript into a new session in the chosen destination: No Repo (the
 * general workspace, no repository binding) or one of the trusted projects.
 * The source session is never moved or deleted.
 */
import type { ReactElement } from 'react';
import type { ProjectRecord, SessionScope } from '@piwin/contracts';
import { Button, Dialog } from '@piwin/ui-kit';
import { getDesktopCopy, type DesktopLocale } from './desktop-locale';
import { projectDisplayName } from './project-display-name';

export type ContinueSessionInProjectDialogProps = {
  /** Source session name; `null` keeps the dialog closed. */
  sessionName: string | null;
  busy: boolean;
  trustedProjects: readonly ProjectRecord[];
  locale: DesktopLocale;
  onOpenChange: (open: boolean) => void;
  onSelectTarget: (targetScope: SessionScope) => void;
  onCancel: () => void;
};

export function ContinueSessionInProjectDialog(
  props: ContinueSessionInProjectDialogProps,
): ReactElement {
  const isChinese = props.locale === 'zh-CN';
  const noRepoLabel = getDesktopCopy(props.locale).sidebar.noRepo;
  const sessionName = props.sessionName ?? '';

  return (
    <Dialog
      label={isChinese ? '继续到项目' : 'Continue in project'}
      open={props.sessionName !== null}
      onOpenChange={props.onOpenChange}
      testId="continue-session-in-project-dialog"
    >
      <h3>{isChinese ? '选择目标工作区' : 'Choose a destination'}</h3>
      <p className="muted">
        {isChinese
          ? `将“${sessionName}”的完整历史复制到目标会话；原会话会保留。继续到 ${noRepoLabel} 会在不绑定仓库的通用工作区继续。`
          : `Copy the full history of “${sessionName}” into a destination session. The original remains unchanged. ${noRepoLabel} continues in the general workspace without a repository binding.`}
      </p>
      <div className="continue-session-project-list">
        <Button
          disabled={props.busy}
          data-testid="continue-session-no-repo-option"
          onClick={() => props.onSelectTarget({ kind: 'general' })}
        >
          {isChinese ? `${noRepoLabel}（不绑定仓库）` : `${noRepoLabel} (no repository)`}
        </Button>
        {props.trustedProjects.map((project) => (
          <Button
            key={project.path}
            disabled={props.busy}
            data-testid="continue-session-project-option"
            onClick={() => props.onSelectTarget({ kind: 'project', projectPath: project.path })}
          >
            {projectDisplayName(project.path)}
          </Button>
        ))}
        {props.trustedProjects.length === 0 ? (
          <p className="muted">{isChinese ? '暂无已信任的项目。' : 'No trusted projects yet.'}</p>
        ) : null}
      </div>
      <div className="modal-actions">
        <Button variant="ghost" disabled={props.busy} onClick={props.onCancel}>
          {isChinese ? '取消' : 'Cancel'}
        </Button>
      </div>
    </Dialog>
  );
}
