/**
 * Section 2 of the preset editor: plain-language radio selector for choosing
 * whether a preset is inactive, global default, or enabled on checked projects.
 */
import { useId, type ReactElement } from 'react';
import { Button, IconFolder, IconFolderPlus } from '@piwin/ui-kit';
import { SYSTEM_PROMPT_BUILTIN_ID, type SystemPromptPreset } from '@piwin/contracts';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import {
  formatProjectOptionLabel,
  type PresetActivationScope,
  type SystemPromptProjectOption,
} from './system-prompt-projects';

export type PresetScopeSelectorProps = {
  scope: PresetActivationScope;
  selectedProjectPaths: readonly string[];
  activePresetId: string | undefined;
  currentGlobalPresetName?: string | undefined;
  presets: readonly SystemPromptPreset[];
  projectOptions: readonly SystemPromptProjectOption[];
  canBrowseProjectDir: boolean;
  isDraft: boolean;
  disabled?: boolean;
  onScopeChange: (nextScope: PresetActivationScope) => void;
  onToggleProjectPath: (projectPath: string, checked: boolean) => void;
  onBrowseProjectDir: () => void;
};

function otherAssignmentNote(
  option: SystemPromptProjectOption,
  activePresetId: string | undefined,
  presets: readonly SystemPromptPreset[],
  isZh: boolean,
): string | null {
  const assigned = option.assignedPresetId;
  if (!assigned || assigned === activePresetId) {
    return null;
  }
  if (assigned === SYSTEM_PROMPT_BUILTIN_ID) {
    return isZh ? '当前：系统默认' : 'Currently: Built-in';
  }
  const matched = presets.find((item) => item.id === assigned);
  if (!matched) {
    return null;
  }
  return isZh ? `当前：${matched.name}` : `Currently: ${matched.name}`;
}

export function PresetScopeSelector(props: PresetScopeSelectorProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const radioName = useId();
  const selectedSet = new Set(props.selectedProjectPaths);

  const scopeOptions: ReadonlyArray<{
    value: PresetActivationScope;
    title: string;
    desc: string;
    note?: string | undefined;
  }> = [
    {
      value: 'off',
      title: isZh ? '暂不启用' : 'Inactive',
      desc: isZh
        ? '仅保存方案，不自动生效'
        : 'Saved in library only; not applied automatically',
    },
    {
      value: 'global',
      title: isZh ? '全局默认' : 'Global default',
      desc: isZh
        ? '所有未单独指定方案的项目与对话都使用它'
        : 'Used across all projects and chats without a specific override',
      ...(props.currentGlobalPresetName && props.scope !== 'global'
        ? {
            note: isZh
              ? `当前全局默认：${props.currentGlobalPresetName}，切换后将替换`
              : `Current global default: ${props.currentGlobalPresetName} (will be replaced)`,
          }
        : {}),
    },
    {
      value: 'projects',
      title: isZh ? '指定项目' : 'Specific projects',
      desc: isZh ? '仅在下方勾选的项目中生效' : 'Applied only to the projects checked below',
    },
  ];

  return (
    <div className="sysprompt-section-block" data-testid="system-prompts-scope-section">
      <div className="sysprompt-section-head">
        <div className="sysprompt-section-heading">
          <span className="sysprompt-section-title">
            {isZh ? '2. 生效范围' : '2. Activation scope'}
          </span>
          <span className="sysprompt-section-hint">
            {props.isDraft
              ? isZh
                ? '保存方案时会一并应用此处选择的生效范围'
                : 'Applied automatically when you save this preset'
              : isZh
                ? '决定这个方案是否启用以及对谁生效，修改后立即生效'
                : 'Controls whether and where this preset is active; applies immediately'}
          </span>
        </div>
      </div>

      <div
        className="sysprompt-scope-options"
        role="radiogroup"
        aria-label={isZh ? '生效范围' : 'Activation scope'}
      >
        {scopeOptions.map((option) => {
          const selected = props.scope === option.value;
          return (
            <label
              key={option.value}
              className={`sysprompt-scope-option${selected ? ' is-selected' : ''}`}
              data-testid={`system-prompts-scope-${option.value}`}
            >
              <input
                type="radio"
                className="sysprompt-option-radio"
                name={radioName}
                value={option.value}
                checked={selected}
                disabled={props.disabled}
                onChange={() => props.onScopeChange(option.value)}
              />
              <span className="sysprompt-option-body">
                <span className="sysprompt-option-title">{option.title}</span>
                <span className="sysprompt-option-desc">{option.desc}</span>
                {option.note ? (
                  <span className="sysprompt-scope-option-note">{option.note}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>

      {props.scope === 'projects' ? (
        <div className="sysprompt-project-checklist" data-testid="system-prompts-project-checklist">
          {props.projectOptions.length > 0 ? (
            props.projectOptions.map((option) => {
              const checked = selectedSet.has(option.path);
              const note = !checked
                ? otherAssignmentNote(option, props.activePresetId, props.presets, isZh)
                : null;
              return (
                <label
                  key={option.path}
                  className={`sysprompt-project-check-row${checked ? ' is-checked' : ''}`}
                  title={option.path}
                >
                  <input
                    type="checkbox"
                    className="sysprompt-project-checkbox"
                    checked={checked}
                    disabled={props.disabled}
                    data-testid="sysprompt-project-checkbox"
                    data-project-path={option.path}
                    onChange={(event) =>
                      props.onToggleProjectPath(option.path, event.currentTarget.checked)
                    }
                  />
                  <IconFolder size={13} />
                  <span className="sysprompt-project-check-main">
                    <span className="sysprompt-project-check-name">
                      {formatProjectOptionLabel(option, isZh)}
                    </span>
                    <span className="sysprompt-project-check-path">{option.path}</span>
                  </span>
                  {note ? <span className="sysprompt-project-check-note">{note}</span> : null}
                </label>
              );
            })
          ) : (
            <div className="sysprompt-project-checklist-empty">
              {isZh
                ? '暂无已知项目，请点击下方按钮选择项目目录'
                : 'No known projects yet. Choose a project folder below.'}
            </div>
          )}

          {props.selectedProjectPaths.length === 0 ? (
            <div className="sysprompt-project-checklist-hint">
              {isZh ? '请至少勾选一个项目后生效' : 'Check at least one project to activate.'}
            </div>
          ) : null}

          {props.canBrowseProjectDir ? (
            <div className="sysprompt-project-checklist-footer">
              <Button
                size="compact"
                variant="ghost"
                disabled={props.disabled}
                onClick={props.onBrowseProjectDir}
                data-testid="system-prompts-browse-project-btn"
              >
                <IconFolderPlus size={13} />
                <span>{isZh ? '选择其他项目目录…' : 'Choose another folder…'}</span>
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
