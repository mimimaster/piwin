import { useEffect, useMemo, useState } from 'react';
import type { SkillSummary } from '@piwin/contracts';
import { resourceSourceLabel } from '@piwin/contracts';
import { Button, Switch } from '@piwin/ui-kit';
import { catalogDescription } from '../tool-cards/catalog-display-copy.js';
import { shortSkillPathLabel } from './skill-path-mapping.js';

export type MappedSkillsGroupProps = {
  skills: readonly SkillSummary[];
  mappedPaths: readonly string[];
  filterActive: boolean;
  isChinese: boolean;
  readOnly?: boolean;
  busy: boolean;
  onToggleSkill: (skill: SkillSummary) => void;
  onExcludeSkills: (skills: readonly SkillSummary[]) => void;
  onUnmapPath: (path: string) => void;
};

export function MappedSkillsGroup(props: MappedSkillsGroupProps) {
  const { skills, mappedPaths, filterActive, isChinese, readOnly, busy } = props;
  const sourceLocale = isChinese ? 'zh-CN' : 'en';
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const availableIds = new Set(skills.map((skill) => skill.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => availableIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
    if (skills.length === 0) {
      setBatchMode(false);
    }
  }, [skills]);

  const activePaths = useMemo(() => {
    const fromSkills = new Set<string>();
    for (const skill of skills) {
      if (skill.mappedFrom) fromSkills.add(skill.mappedFrom);
    }
    return fromSkills.size > 0 ? [...fromSkills] : [...mappedPaths];
  }, [skills, mappedPaths]);

  const disabledSkills = useMemo(() => skills.filter((skill) => !skill.enabled), [skills]);
  const selectedSkills = useMemo(
    () => skills.filter((skill) => selectedIds.has(skill.id)),
    [skills, selectedIds],
  );
  const allSelected = skills.length > 0 && selectedSkills.length === skills.length;

  function toggleSelected(skillId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(skillId)) {
        next.delete(skillId);
      } else {
        next.add(skillId);
      }
      return next;
    });
  }

  function handleSelectAllToggle() {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(skills.map((skill) => skill.id)));
  }

  function handleSelectDisabled() {
    setSelectedIds(new Set(disabledSkills.map((skill) => skill.id)));
  }

  function handleBatchRemove() {
    if (selectedSkills.length === 0) return;
    props.onExcludeSkills(selectedSkills);
    setSelectedIds(new Set());
    setBatchMode(false);
  }

  return (
    <section className="ext-list-group" data-testid="skills-group-mapped">
      <div className="ext-list-group-header">
        <div className="ext-list-group-header-title">
          <h3 className="muted ext-list-group-title">
            {resourceSourceLabel('mapped', sourceLocale)}
          </h3>
          <span className="pill muted">{skills.length}</span>
          {activePaths.map((path, index) => (
            <span key={path} className="ext-mapped-path-chip" title={path}>
              <span className="ext-mapped-path-label">{path}</span>
              {!readOnly ? (
                <button
                  type="button"
                  className="ext-mapped-path-unmap"
                  disabled={busy}
                  onClick={() => props.onUnmapPath(path)}
                  title={isChinese ? `取消映射 ${path}` : `Unmap ${path}`}
                  aria-label={isChinese ? `取消映射 ${path}` : `Unmap ${path}`}
                  data-testid={`mapped-header-unmap-${index}`}
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>

        {!readOnly ? (
          <div className="ext-list-group-actions">
            {!batchMode ? (
              <>
                {filterActive && skills.length > 0 ? (
                  <Button
                    size="compact"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => props.onExcludeSkills(skills)}
                    data-testid="mapped-exclude-filtered"
                  >
                    {isChinese
                      ? `移除匹配项 (${skills.length})`
                      : `Remove matching (${skills.length})`}
                  </Button>
                ) : null}
                {!filterActive && disabledSkills.length > 0 ? (
                  <Button
                    size="compact"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => props.onExcludeSkills(disabledSkills)}
                    data-testid="mapped-exclude-disabled"
                  >
                    {isChinese
                      ? `清理未启用 (${disabledSkills.length})`
                      : `Remove disabled (${disabledSkills.length})`}
                  </Button>
                ) : null}
                {skills.length > 1 ? (
                  <Button
                    size="compact"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setBatchMode(true)}
                    data-testid="mapped-batch-toggle"
                  >
                    {isChinese ? '批量选择' : 'Select'}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                size="compact"
                variant="ghost"
                onClick={() => {
                  setBatchMode(false);
                  setSelectedIds(new Set());
                }}
                data-testid="mapped-batch-cancel"
              >
                {isChinese ? '完成' : 'Done'}
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {batchMode && !readOnly ? (
        <div className="ext-mapped-batch-bar" data-testid="mapped-batch-bar">
          <div className="ext-mapped-batch-actions">
            <Button
              size="compact"
              variant="ghost"
              disabled={busy}
              onClick={handleSelectAllToggle}
              data-testid="mapped-batch-select-all"
            >
              {allSelected
                ? isChinese
                  ? '取消全选'
                  : 'Deselect all'
                : isChinese
                  ? `全选 (${skills.length})`
                  : `Select all (${skills.length})`}
            </Button>
            {disabledSkills.length > 0 && disabledSkills.length < skills.length ? (
              <Button
                size="compact"
                variant="ghost"
                disabled={busy}
                onClick={handleSelectDisabled}
                data-testid="mapped-batch-select-disabled"
              >
                {isChinese
                  ? `选未启用 (${disabledSkills.length})`
                  : `Select disabled (${disabledSkills.length})`}
              </Button>
            ) : null}
          </div>
          <Button
            size="compact"
            variant="danger"
            disabled={busy || selectedSkills.length === 0}
            onClick={handleBatchRemove}
            data-testid="mapped-batch-remove"
          >
            {isChinese
              ? `移除选中 (${selectedSkills.length})`
              : `Remove (${selectedSkills.length})`}
          </Button>
        </div>
      ) : null}

      <ul className="ext-list">
        {skills.map((skill) => {
          const selected = selectedIds.has(skill.id);
          return (
            <li
              key={skill.id}
              className={
                batchMode
                  ? `ext-list-item ext-list-item--selectable${selected ? ' active' : ''}`
                  : 'ext-list-item'
              }
              onClick={batchMode ? () => toggleSelected(skill.id) : undefined}
            >
              {batchMode ? (
                <input
                  type="checkbox"
                  className="ext-mapped-checkbox"
                  checked={selected}
                  onChange={() => toggleSelected(skill.id)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={isChinese ? `选择 ${skill.name}` : `Select ${skill.name}`}
                  data-testid={`mapped-select-${skill.id}`}
                />
              ) : null}
              <div className="ext-list-main">
                <div className="ext-list-title">
                  <strong>{skill.name}</strong>
                  <span className="pill muted">
                    {resourceSourceLabel(skill.source, sourceLocale)}
                  </span>
                  {skill.enabled ? (
                    <span className="pill ok">{isChinese ? '已启用' : 'on'}</span>
                  ) : null}
                  {skill.mappedFrom && mappedPaths.length > 1 ? (
                    <span className="pill muted" title={skill.mappedFrom}>
                      {shortSkillPathLabel(skill.mappedFrom)}
                    </span>
                  ) : null}
                </div>
                <div className="muted ext-desc">
                  {catalogDescription(skill.id, skill.description, sourceLocale)}
                </div>
              </div>
              {!batchMode ? (
                <div className="ext-list-actions">
                  <Button
                    size="compact"
                    variant="ghost"
                    disabled={readOnly || busy}
                    onClick={() => props.onExcludeSkills([skill])}
                    data-testid={`skill-exclude-${skill.id}`}
                  >
                    {isChinese ? '移除' : 'Remove'}
                  </Button>
                  <Switch
                    checked={skill.enabled}
                    disabled={readOnly}
                    onCheckedChange={() => props.onToggleSkill(skill)}
                    aria-label={isChinese ? `启用 ${skill.name}` : `Enable ${skill.name}`}
                    testId={`skill-toggle-${skill.id}`}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
