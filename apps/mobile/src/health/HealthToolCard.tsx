import { useState, type ReactElement } from 'react';
import type { HealthToolCardSummary, ToolPresentation } from '@piwin/contracts';
import { resolveHealthToolCardStatus } from '@piwin/contracts';

export type HealthToolCardProps = {
  presentation?: ToolPresentation;
  status?: HealthToolCardSummary['status'];
  toolStatus?: 'running' | 'done' | 'error';
};

const STATUS_COPY: Record<HealthToolCardSummary['status'], string> = {
  'waiting-for-phone': '等待 iPhone',
  'awaiting-consent': '等待确认',
  'awaiting-healthkit-authorization': '等待系统授权',
  reading: '正在读取',
  completed: '已完成',
  partial: '部分结果',
  denied: '已拒绝',
  'no-data': '无可用数据',
  'phone-offline': '手机离线',
  'timed-out': '已超时',
  cancelled: '已取消',
  failed: '失败',
};

export function healthCardStatusFromPresentation(
  presentation: ToolPresentation | undefined,
  toolStatus?: 'running' | 'done' | 'error',
): HealthToolCardSummary['status'] {
  return resolveHealthToolCardStatus(presentation, toolStatus);
}

export function HealthToolCard({
  presentation,
  status,
  toolStatus,
}: HealthToolCardProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const health = presentation?.health;
  const resolvedStatus = status ?? resolveHealthToolCardStatus(presentation, toolStatus);
  const metrics = health?.metrics?.join('、') ?? presentation?.summary ?? 'Apple Health';
  const period = health?.periodLabel ?? '';
  const freshness = health?.freshnessLabel ?? '';

  return (
    <article className="health-tool-card" data-testid="health-tool-card">
      <button
        type="button"
        className="health-tool-card-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span>读取 Apple Health · {STATUS_COPY[resolvedStatus]}</span>
        <span>
          {period}
          {period && metrics ? '：' : ''}
          {metrics}
          {freshness ? ` · 更新至 ${freshness}` : ''}
        </span>
      </button>
      {expanded ? (
        <div className="health-tool-card-body">
          {health?.timezone ? <p>时区 {health.timezone}</p> : null}
          {health?.unavailableMetrics && health.unavailableMetrics.length > 0 ? (
            <p>不可用：{health.unavailableMetrics.join('、')}</p>
          ) : null}
          {health?.warnings && health.warnings.length > 0 ? (
            <p>提示：{health.warnings.join('、')}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
