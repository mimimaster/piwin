import { useState } from 'react';
import { WELL_KNOWN_SKILL_PATH_PRESETS } from '@piwin/contracts';
import { Button, Collapse } from '@piwin/ui-kit';
import { PageTitle } from '../settings/page-title';
import { isPresetSkillPath } from './skill-path-mapping.js';

export type ExternalSkillMappingSectionProps = {
  mappedPaths: readonly string[];
  excludedIds: readonly string[];
  isChinese: boolean;
  readOnly?: boolean;
  busy: boolean;
  onSetMapping: (path: string, mapped: boolean) => void;
  onRestoreExcluded: (skillId: string) => void;
  onRestoreAllExcluded: () => void;
};

export function ExternalSkillMappingSection(props: ExternalSkillMappingSectionProps) {
  const { mappedPaths, excludedIds, isChinese, readOnly, busy } = props;
  const [excludedOpen, setExcludedOpen] = useState(false);
  const customPaths = mappedPaths.filter((path) => !isPresetSkillPath(path));

  return (
    <div
      className="settings-section"
      style={{ paddingTop: 24, borderTop: '1px solid var(--line-soft)' }}
    >
      <PageTitle
        title={isChinese ? '映射外部路径' : 'Map External Paths'}
        description={
          isChinese
            ? '从 Cursor、Claude、Codex 等目录映射已有技能，也可随时取消映射或恢复已屏蔽技能。'
            : 'Map skill roots from Cursor, Claude, Codex, or Agents, or restore excluded skills.'
        }
      />
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {WELL_KNOWN_SKILL_PATH_PRESETS.map((preset) => {
          const mapped = mappedPaths.includes(preset.path);
          return (
            <Button
              key={preset.id}
              size="compact"
              variant={mapped ? 'ghost' : 'secondary'}
              disabled={busy || readOnly}
              onClick={() => props.onSetMapping(preset.path, !mapped)}
              title={preset.path}
              data-testid={`skill-map-${preset.id}`}
            >
              {mapped
                ? isChinese
                  ? `✓ ${preset.label}（点击取消）`
                  : `✓ ${preset.label} (click to unmap)`
                : isChinese
                  ? `映射 ${preset.label}`
                  : `Map ${preset.label}`}
            </Button>
          );
        })}
        {customPaths.map((path, index) => (
          <Button
            key={path}
            size="compact"
            variant="ghost"
            disabled={busy || readOnly}
            onClick={() => props.onSetMapping(path, false)}
            title={path}
            data-testid={`skill-map-custom-${index}`}
          >
            {isChinese ? `✓ ${path}（点击取消）` : `✓ ${path} (click to unmap)`}
          </Button>
        ))}
      </div>

      {excludedIds.length > 0 ? (
        <div className="ext-excluded-tray" data-testid="mapped-excluded-tray">
          <div className="ext-excluded-tray-header">
            <span className="muted ext-excluded-summary">
              {isChinese
                ? `已屏蔽 ${excludedIds.length} 个映射技能`
                : `${excludedIds.length} mapped ${excludedIds.length === 1 ? 'skill' : 'skills'} excluded`}
            </span>
            <div className="ext-list-group-actions">
              <Button
                size="compact"
                variant="ghost"
                onClick={() => setExcludedOpen((open) => !open)}
                data-testid="mapped-excluded-toggle"
              >
                {excludedOpen
                  ? isChinese
                    ? '收起'
                    : 'Hide'
                  : isChinese
                    ? '查看'
                    : 'Show'}
              </Button>
              {!readOnly ? (
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={busy}
                  onClick={props.onRestoreAllExcluded}
                  data-testid="mapped-excluded-restore-all"
                >
                  {isChinese ? '全部恢复' : 'Restore all'}
                </Button>
              ) : null}
            </div>
          </div>
          <Collapse expanded={excludedOpen}>
            <div className="ext-excluded-chips">
              {excludedIds.map((skillId) => (
                <button
                  key={skillId}
                  type="button"
                  className="ext-excluded-chip"
                  disabled={busy || readOnly}
                  onClick={() => props.onRestoreExcluded(skillId)}
                  title={isChinese ? `恢复 ${skillId}` : `Restore ${skillId}`}
                  data-testid={`mapped-restore-${skillId}`}
                >
                  <span>{skillId}</span>
                  <span aria-hidden="true">↺</span>
                </button>
              ))}
            </div>
          </Collapse>
        </div>
      ) : null}
    </div>
  );
}
