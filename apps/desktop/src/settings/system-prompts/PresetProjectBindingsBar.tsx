/**
 * Compact strip inside CustomPresetsPanel showing which projects are bound to
 * the active saved preset and letting the user focus, unbind, or add projects.
 */
import type { ReactElement } from 'react';
import { IconClose, IconFolder } from '@piwin/ui-kit';
import { SYSTEM_PROMPT_BUILTIN_ID, type SystemPromptPreset } from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import {
  formatProjectOptionLabel,
  listBoundProjectsForPreset,
  SYSTEM_PROMPT_BROWSE_PROJECT_VALUE,
  type SystemPromptProjectOption,
} from './system-prompt-projects';

function currentAssignmentSuffix(
  option: SystemPromptProjectOption,
  presets: readonly SystemPromptPreset[],
  isZh: boolean,
): string {
  const assigned = option.assignedPresetId;
  if (!assigned) return '';
  if (assigned === SYSTEM_PROMPT_BUILTIN_ID) {
    return isZh ? ' · 当前：系统默认' : ' · Currently: Built-in';
  }
  const matched = presets.find((item) => item.id === assigned);
  if (!matched) return '';
  return isZh ? ` · 当前：${matched.name}` : ` · Currently: ${matched.name}`;
}

export function PresetProjectBindingsBar(props: {
  preset: SystemPromptPreset;
  presets: readonly SystemPromptPreset[];
  projectOptions: readonly SystemPromptProjectOption[];
  selectedProjectPath: string | null;
  canBrowseProjectDir: boolean;
  disabled?: boolean;
  onBindProject: (projectPath: string) => void;
  onUnbindProject: (projectPath: string) => void;
  onFocusProject: (projectPath: string) => void;
  onBrowseProjectDir: () => void;
}): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';

  const boundProjects = listBoundProjectsForPreset(props.projectOptions, props.preset.id);
  const unboundOptions = props.projectOptions.filter(
    (item) => item.assignedPresetId !== props.preset.id,
  );

  return (
    <div className="sysprompt-project-bindings" data-testid="system-prompts-preset-projects">
      <span className="sysprompt-project-bindings-label">{isZh ? '生效项目' : 'Projects'}</span>
      <div className="sysprompt-project-bindings-list">
        {boundProjects.length > 0 ? (
          boundProjects.map((project, index) => {
            const label = formatProjectOptionLabel(project, isZh);
            const focused = project.path === props.selectedProjectPath;
            return (
              <span
                key={project.path}
                className={`sysprompt-project-chip${focused ? ' is-focused' : ''}`}
                data-testid="sysprompt-bound-project-chip"
                data-project-path={project.path}
                title={project.path}
              >
                <button
                  type="button"
                  className="sysprompt-project-chip-main"
                  onClick={() => props.onFocusProject(project.path)}
                >
                  <IconFolder size={12} />
                  <span>{label}</span>
                </button>
                <button
                  type="button"
                  className="sysprompt-project-chip-remove"
                  disabled={props.disabled}
                  onClick={() => props.onUnbindProject(project.path)}
                  aria-label={isZh ? `取消绑定 ${label}` : `Unbind ${label}`}
                  title={isZh ? '取消绑定' : 'Unbind'}
                  data-testid={`sysprompt-unbind-project-${index}`}
                >
                  <IconClose size={11} />
                </button>
              </span>
            );
          })
        ) : (
          <span className="sysprompt-project-bindings-empty">
            {isZh ? '未单独绑定项目' : 'No project overrides'}
          </span>
        )}

        {unboundOptions.length > 0 || props.canBrowseProjectDir ? (
          <select
            className="sysprompt-project-add-select"
            value=""
            disabled={props.disabled}
            aria-label={isZh ? '添加生效项目' : 'Add target project'}
            data-testid="system-prompts-preset-add-project"
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (!value) return;
              if (value === SYSTEM_PROMPT_BROWSE_PROJECT_VALUE) {
                props.onBrowseProjectDir();
                return;
              }
              props.onBindProject(value);
            }}
          >
            <option value="">{isZh ? '+ 添加项目…' : '+ Add project…'}</option>
            {unboundOptions.map((option) => (
              <option key={option.path} value={option.path}>
                {formatProjectOptionLabel(option, isZh)}
                {currentAssignmentSuffix(option, props.presets, isZh)}
              </option>
            ))}
            {props.canBrowseProjectDir ? (
              <option value={SYSTEM_PROMPT_BROWSE_PROJECT_VALUE}>
                {isZh ? '浏览其他项目目录…' : 'Browse another folder…'}
              </option>
            ) : null}
          </select>
        ) : null}
      </div>
    </div>
  );
}
