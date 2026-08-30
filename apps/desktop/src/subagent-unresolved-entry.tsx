/**
 * Persistent parent-turn row for a subagent result that still needs resolution.
 * Clicking asks the parent agent to handle it — never worktree apply.
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { IconWarn } from './shell-icons';

export type SubagentUnresolvedEntryProps = {
  resultId: string;
  title: string;
  reason?: string;
  locale?: 'zh-CN' | 'en';
  onRequestResolution: (resultId: string) => void;
};

export function SubagentUnresolvedEntry(props: SubagentUnresolvedEntryProps): ReactElement {
  const { locale: contextLocale } = useDesktopLocale();
  const isZh = (props.locale ?? contextLocale) === 'zh-CN';
  const heading = isZh ? '尚未合入' : 'Unresolved result';
  const actionLabel = isZh ? '让主代理处理' : 'Ask parent agent';
  const hint = isZh
    ? '将发送后续请求，由主代理检查并处理'
    : 'Sends a follow-up for the parent agent to inspect and handle';

  return (
    <section
      className="subagent-unresolved-entry"
      data-testid="subagent-unresolved-entry"
      data-result-id={props.resultId}
      aria-label={`${heading}: ${props.title}`}
      onClick={() => props.onRequestResolution(props.resultId)}
    >
      <IconWarn className="subagent-unresolved-entry-icon" />
      <div className="subagent-unresolved-entry-body">
        <span className="subagent-unresolved-entry-kicker">{heading}</span>
        <strong className="subagent-unresolved-entry-title">{props.title}</strong>
        {props.reason ? (
          <span className="subagent-unresolved-entry-reason">{props.reason}</span>
        ) : null}
      </div>
      <Button
        variant="secondary"
        size="compact"
        data-testid="subagent-unresolved-resolve"
        title={hint}
        onClick={(event) => {
          event.stopPropagation();
          props.onRequestResolution(props.resultId);
        }}
      >
        {actionLabel}
      </Button>
    </section>
  );
}
