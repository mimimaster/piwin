/**
 * Per-scope Artifact surface switches (General chat / Project chat × Inline /
 * Canvas), rendered under the Artifact master switch.
 *
 * Presentational only: `ArtifactPage` owns the draft, so this component stays
 * small and the page stays under the 400-line review threshold.
 */
import type { ReactElement } from 'react';
import type {
  ArtifactScopeKey,
  ArtifactScopesConfig,
  ArtifactSurfaceSwitches,
} from '@piwin/contracts';
import { Switch } from '@piwin/ui-kit';
import { FieldRow } from '../field-row';

export type ArtifactScopeTreeProps = {
  scopes: ArtifactScopesConfig;
  onChange: (
    scopeKey: ArtifactScopeKey,
    surface: keyof ArtifactSurfaceSwitches,
    value: boolean,
  ) => void;
  isZh: boolean;
};

type ScopeCopy = {
  key: ArtifactScopeKey;
  label: string;
  hint: string;
};

/** Scope classes mirror `SessionScope.kind`, which is what Host compiles. */
function scopeCopy(isZh: boolean): readonly ScopeCopy[] {
  return [
    {
      key: 'general',
      label: isZh ? '通用会话' : 'General chat',
      hint: isZh
        ? '首页与素笺等通用会话。此处的开关仅对该类会话生效。'
        : 'Conversation sessions in the general scope (Home / Clean Slate). These switches apply to that class only.',
    },
    {
      key: 'project',
      label: isZh ? '项目会话' : 'Project chat',
      hint: isZh
        ? '项目工作区内的 Agent 会话（含无 Git 仓库的项目）。'
        : 'Agent sessions inside a project folder, including No Repo.',
    },
  ];
}

function surfaceCopy(isZh: boolean) {
  return {
    inline: {
      label: isZh ? 'Inline Artifact' : 'Inline Artifact',
      description: isZh
        ? '在对话列内联渲染的 Artifact。关闭后该分类只输出源码。'
        : 'Artifacts rendered inside the chat column. Off keeps that class source-only.',
    },
    canvas: {
      label: isZh ? 'Canvas Artifact' : 'Canvas Artifact',
      description: isZh
        ? '右侧 Canvas 工作区，包含自动打开。关闭后不生成也不打开。'
        : 'Right-side Canvas workspace, including auto-open. Off generates and opens nothing.',
    },
  } satisfies Record<keyof ArtifactSurfaceSwitches, { label: string; description: string }>;
}

export function ArtifactScopeTree(props: ArtifactScopeTreeProps): ReactElement {
  const { isZh, scopes, onChange } = props;
  const surfaces = surfaceCopy(isZh);

  return (
    <div data-testid="artifact-scope-tree">
      {scopeCopy(isZh).map((scope) => {
        const switches = scopes[scope.key];
        return (
          <div
            key={scope.key}
            data-testid={`artifact-scope-${scope.key}`}
            style={{
              borderLeft: '2px solid var(--piwin-border-1, rgba(127, 127, 127, 0.28))',
              paddingLeft: 10,
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.9em' }}>{scope.label}</div>
            <div style={{ opacity: 0.65, fontSize: '0.78em', marginBottom: 4 }}>{scope.hint}</div>
            {(['inline', 'canvas'] as const).map((surface) => (
              <FieldRow
                key={surface}
                label={surfaces[surface].label}
                description={surfaces[surface].description}
                testId={`artifact-scope-${scope.key}-${surface}-row`}
              >
                <Switch
                  checked={switches[surface]}
                  onCheckedChange={(checked) => onChange(scope.key, surface, checked)}
                  aria-label={`${scope.label} ${surfaces[surface].label}`}
                  testId={`artifact-scope-${scope.key}-${surface}-switch`}
                />
              </FieldRow>
            ))}
          </div>
        );
      })}
    </div>
  );
}
