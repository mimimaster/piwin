import type { ReactElement } from 'react';
import type { EmptyStageLandingProps } from './empty-stage-landing.js';
import { SessionEntryCard } from './session-entry-card.js';

export function resolveEngineLabel(
  agentId: string,
  label: string,
  isChinese: boolean,
): string {
  if (agentId === 'pi') {
    return isChinese ? 'piwin 会话' : 'piwin session';
  }
  if (agentId === 'grok') {
    return isChinese ? 'grok 会话' : 'grok session';
  }
  const cleanLabel = (label || agentId).trim();
  if (isChinese) {
    return cleanLabel.endsWith('会话') ? cleanLabel : `${cleanLabel} 会话`;
  }
  return cleanLabel.toLowerCase().endsWith('session') ? cleanLabel : `${cleanLabel} session`;
}

/** Choose the agent engine; the titlebar separately selects the shell view. */
export function EmptyStageSessionChoices(props: Pick<EmptyStageLandingProps,
  'locale' | 'draftAgentId' | 'draftAgentOptions' | 'onSelectDraftAgent' | 'onOpenAgentSettings'
>): ReactElement | null {
  const chinese = props.locale === 'zh-CN';
  const options = props.draftAgentOptions ?? [];
  if (options.length <= 1) return null;
  return (
    <div
      className="empty-stage-engines"
      data-testid="empty-stage-engines"
      role="radiogroup"
      aria-label={chinese ? '选择会话入口' : 'Select session entry'}
    >
      {options.map((option) => {
        const name = resolveEngineLabel(option.agentId, option.label, chinese);
        const badge = option.agentId === 'pi'
          ? chinese ? '内置' : 'Built-in'
          : option.ready
            ? chinese ? '已就绪' : 'Ready'
            : option.state === 'unauthenticated'
              ? chinese ? '未登录' : 'Sign-in Required'
              : option.state === 'unavailable'
                ? chinese ? '未就绪' : 'Not Ready'
                : chinese ? '未安装 CLI' : 'CLI Missing';
        return (
          <SessionEntryCard
            key={option.agentId}
            name={name}
            badge={badge}
            selected={(props.draftAgentId ?? 'pi') === option.agentId}
            ready={option.ready}
            builtin={option.agentId === 'pi'}
            testId={`empty-stage-engine-${option.agentId}`}
            title={option.description || name}
            onSelect={() => props.onSelectDraftAgent?.(option.agentId)}
          >
            {!option.ready && props.onOpenAgentSettings ? (
              <span className="empty-stage-engine-footer">
                <span
                  className="empty-stage-engine-settings-link"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpenAgentSettings?.();
                  }}
                >
                  {chinese ? '配置环境 →' : 'Configure →'}
                </span>
              </span>
            ) : null}
          </SessionEntryCard>
        );
      })}

    </div>
  );
}
