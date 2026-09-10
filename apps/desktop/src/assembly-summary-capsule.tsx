import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { ContextSummaryPush } from '@piwin/contracts';
import { IconChevronDown } from './shell-icons';
import { requestTranscriptTurnMeasure } from './transcript-turn-measure.js';

export function resolveAssemblySummaryForUserMessage(input: {
  messageId: string;
  messageRunId?: string;
  lastUserMessageId: string | null;
  activeRunId: string | null;
  followingAssistantRunId?: string;
  summariesByRunId: Record<string, ContextSummaryPush>;
}): ContextSummaryPush | undefined {
  const byUserMessage = input.summariesByRunId[input.messageId];
  if (byUserMessage) {
    return byUserMessage;
  }
  const candidates = [
    input.messageRunId,
    input.messageId === input.lastUserMessageId ? (input.activeRunId ?? undefined) : undefined,
    input.followingAssistantRunId,
  ];
  for (const runId of candidates) {
    if (runId === undefined) continue;
    const summary = input.summariesByRunId[runId];
    if (summary) return summary;
  }
  return undefined;
}

function trustOriginLabel(origin: ContextSummaryPush['contributions'][number]['trustOrigin'], zh: boolean): string {
  switch (origin) {
    case 'user':
      return zh ? '用户' : 'user';
    case 'piwin':
      return zh ? 'Host 装配' : 'host assembly';
    case 'local-file':
      return zh ? '本地文件' : 'local file';
    case 'project':
      return zh ? '项目' : 'project';
    case 'external-web':
      return zh ? '外部网页（不可信）' : 'external web (untrusted)';
    case 'mcp':
      return zh ? 'MCP（不可信）' : 'MCP (untrusted)';
    case 'tool':
      return zh ? '工具（不可信）' : 'tool (untrusted)';
    case 'subagent':
      return zh ? '子代理' : 'subagent';
    default:
      return zh ? '来源未知' : 'unknown origin';
  }
}

function contributionLabel(
  item: ContextSummaryPush['contributions'][number],
  zh: boolean,
): string {
  if (item.displayPath) {
    return item.displayPath;
  }
  if (zh) {
    if (item.label === 'User') return '用户消息';
    if (item.label === 'Steer') return '转向消息';
  }
  return item.label;
}

function isUntrustedOrigin(origin: ContextSummaryPush['contributions'][number]['trustOrigin']): boolean {
  return origin === 'external-web' || origin === 'mcp' || origin === 'tool';
}

export function AssemblySummaryCapsule(props: {
  summary?: ContextSummaryPush;
  preparing?: boolean;
  locale: 'zh-CN' | 'en';
}): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const zh = props.locale === 'zh-CN';

  // Local expand is invisible to turnsStructureKey; force the virtualizer to
  // re-read this turn body so overflow:hidden on the slot cannot clip the panel.
  useLayoutEffect(() => {
    const turnBody = rootRef.current?.closest('.transcript-turn-window-item-body');
    requestTranscriptTurnMeasure(turnBody instanceof HTMLElement ? turnBody : null);
  }, [open]);

  if (props.summary === undefined) {
    return (
      <div className="fw assembly-summary" data-testid="assembly-summary-capsule">
        <div className="cap is-preparing">
          <span className="lamp" aria-hidden="true" />
          <span>
            {zh ? '正在装配 · 收集本轮 Host 注入…' : 'Preparing assembly · collecting Host injections…'}
          </span>
        </div>
      </div>
    );
  }
  const coverageLabel =
    props.summary.coverage === 'capture-missed'
      ? zh
        ? '装配记录未写入'
        : 'Assembly persist missed'
      : zh
        ? '本轮装配内容'
        : 'This turn’s assembly';
  const tokenLabel =
    props.summary.totalEstimatedTokens === undefined
      ? zh
        ? '估算未知'
        : 'estimate unknown'
      : zh
        ? `约 ${props.summary.totalEstimatedTokens} tokens（估算）`
        : `~${props.summary.totalEstimatedTokens} tokens (estimate)`;
  const labels = props.summary.contributions
    .slice(0, 4)
    .map((item) => contributionLabel(item, zh))
    .join(' · ');
  const title = `${coverageLabel} · ${tokenLabel}${labels.length > 0 ? ` · ${labels}` : ''}`;

  return (
    <div
      ref={rootRef}
      className={`fw assembly-summary${open ? ' open' : ''}`}
      data-testid="assembly-summary-capsule"
    >
      <button
        type="button"
        className="cap"
        data-fold=""
        data-testid="assembly-summary-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <i aria-hidden="true" />
        <span>{title}</span>
        <IconChevronDown className="chev i s12" aria-hidden="true" />
      </button>
      {open ? (
        <div className="cap-d fb assembly-summary-detail" data-testid="assembly-summary-detail">
          <p>
            {zh
              ? '以下是 Host 装配层收集的内容，不是模型最终收到的请求。'
              : 'This is Host assembly, not the payload the model ultimately received.'}
          </p>
          <ul>
            {props.summary.contributions.map((item) => (
              <li key={item.id}>
                <b>{contributionLabel(item, zh)}</b>
                <span className={isUntrustedOrigin(item.trustOrigin) ? 'src warn' : 'src'}>
                  {trustOriginLabel(item.trustOrigin, zh)}
                </span>
                {item.estimatedTokens === undefined ? null : (
                  <span className="ml">
                    {zh ? `约 ${item.estimatedTokens}` : `~${item.estimatedTokens}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
