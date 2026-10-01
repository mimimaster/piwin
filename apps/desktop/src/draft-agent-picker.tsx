/**
 * Draft agent backend selector (ADR 0082).
 *
 * Rendered in the new-session composer only when more than one agent is known.
 * Pi is always the default; an agent that still needs install/login/dependency
 * work stays visible but cannot start a session. When settings navigation is
 * available, its setup affordance opens the Host-backed Agent settings page.
 */
import type { ReactElement } from 'react';
import { SegmentedControl } from '@piwin/ui-kit';
import type { ComposerDraftAgentOption } from './composer-dock-types';
import { useDesktopLocale } from './desktop-locale-context';

export type DraftAgentPickerProps = {
  value: string;
  options: readonly ComposerDraftAgentOption[];
  onChange: (value: string) => void;
  onOpenSettings?: () => void;
  disabled?: boolean;
};

export function DraftAgentPicker(props: DraftAgentPickerProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const notReady = props.options.filter((option) => !option.ready);

  return (
    <div
      className="draft-agent-picker"
      data-testid="draft-agent-picker"
      title={
        notReady.length > 0
          ? notReady
              .map((option) =>
                isZh
                  ? `${option.label}：请先在 设置 → Agents 完成配置`
                  : `${option.label}: finish setup in Settings → Agents`,
              )
              .join('\n')
          : undefined
      }
    >
      <SegmentedControl
        size="compact"
        value={props.value}
        onChange={(val) => {
          // Ignore anything that is not a known agent id so a stale render
          // cannot switch the draft to an unknown backend.
          const option = props.options.find((candidate) => candidate.agentId === val);
          if (option === undefined) {
            return;
          }
          if (!option.ready) {
            props.onOpenSettings?.();
            return;
          }
          props.onChange(val);
        }}
        {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
        data={props.options.map((option) => ({
          value: option.agentId,
          label: option.ready
            ? option.label
            : isZh
              ? `${option.label} · 完成配置`
              : `${option.label} · Setup`,
          // Keep the generic control safe in tests/embedded callers that do
          // not provide navigation, while the workbench makes setup actionable.
          disabled: !option.ready && props.onOpenSettings === undefined,
        }))}
      />
    </div>
  );
}
