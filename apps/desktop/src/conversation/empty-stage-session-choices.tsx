import type { ReactElement } from 'react';
import type { EmptyStageLandingProps } from './empty-stage-landing.js';
import { SessionEntryCard } from '../session/session-entry-card.js';
import { agentBackendStatusCopy } from '../agents/agent-backend-status-copy.js';

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
        const statusCopy = agentBackendStatusCopy(option.ready ? { state: 'ready' } : option, chinese);
        const badge = option.agentId === 'pi'
          ? chinese ? '内置' : 'Built-in'
          : statusCopy.badge;
        return (
          <SessionEntryCard
            key={option.agentId}
            name={name}
            badge={badge}
            selected={(props.draftAgentId ?? 'pi') === option.agentId}
            ready={option.ready}
            builtin={option.agentId === 'pi'}
            {...(option.icon ? { icon: option.icon } : {})}
            testId={`empty-stage-engine-${option.agentId}`}
            title={option.ready ? option.description || name : statusCopy.detail}
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
                  {statusCopy.actionLabel} →
                </span>
              </span>
            ) : null}
          </SessionEntryCard>
        );
      })}

    </div>
  );
}
