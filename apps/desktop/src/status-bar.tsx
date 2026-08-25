/** Compact turn telemetry attached to the Composer. */
import { useEffect, useState, type ReactElement } from 'react';
import type { ContextUsageSnapshot } from '@piwin/contracts';
import {
  IconActivity,
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconCheckCircle,
  IconClock,
  IconDatabase,
  IconTerminal,
} from '@piwin/ui-kit';
import { buildStatusBarMetrics, type StatusBarMetric } from './status-bar-metrics.js';

export type StatusBarProps = {
  agentState?: 'idle' | 'running' | 'error';
  /** Host-authoritative foreground Run start, used only for the live elapsed clock. */
  runStartedAt?: number;
  /** Terminal output arrived while its panel was collapsed. */
  terminalAttention?: boolean;
  /** Latest Host usage sample; absent fields remain absent in the rail. */
  contextUsage?: ContextUsageSnapshot | null;
  locale?: 'zh-CN' | 'en';
};

const STATE_LABELS = {
  'zh-CN': {
    running: '运行中',
    error: '异常',
    lastTurn: '上一轮',
    terminalAttention: '有新输出',
    rail: '本轮运行统计',
  },
  en: {
    running: 'Running',
    error: 'Error',
    lastTurn: 'Last turn',
    terminalAttention: 'New output',
    rail: 'Turn telemetry',
  },
} as const;

function MetricIcon(props: { id: StatusBarMetric['id'] }): ReactElement {
  const iconProps = { 'aria-hidden': true } as const;
  switch (props.id) {
    case 'duration':
      return <IconClock {...iconProps} />;
    case 'input':
      return <IconArrowDown {...iconProps} />;
    case 'output':
      return <IconArrowUp {...iconProps} />;
    case 'cache':
      return <IconDatabase {...iconProps} />;
  }
}

export function StatusBar(props: StatusBarProps): ReactElement | null {
  const locale = props.locale ?? 'zh-CN';
  const labels = STATE_LABELS[locale];
  const agentState = props.agentState ?? 'idle';
  const terminalAttention = props.terminalAttention === true && agentState !== 'running';
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (agentState !== 'running' || typeof props.runStartedAt !== 'number') {
      return undefined;
    }
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [agentState, props.runStartedAt]);

  const metrics = buildStatusBarMetrics({
    usage: props.contextUsage,
    agentState,
    runStartedAt: props.runStartedAt,
    now,
    locale,
  });

  if (agentState === 'idle' && !terminalAttention && metrics.length === 0) {
    return null;
  }

  const stateTone = terminalAttention ? 'attention' : agentState;
  const stateLabel = terminalAttention
    ? labels.terminalAttention
    : agentState === 'running'
      ? labels.running
      : agentState === 'error'
        ? labels.error
        : labels.lastTurn;
  const StateIcon = terminalAttention
    ? IconTerminal
    : agentState === 'running'
      ? IconActivity
      : agentState === 'error'
        ? IconAlertCircle
        : IconCheckCircle;

  return (
    <footer className="status-bar" data-testid="status-bar" aria-label={labels.rail}>
      <div className="status-bar-rail">
        <span
          className={`status-bar-agent state-${stateTone}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="status-bar-agent-icon" aria-hidden>
            <StateIcon />
          </span>
          <span className="status-bar-agent-label">{stateLabel}</span>
        </span>

        {metrics.length > 0 ? (
          <>
            <span className="status-bar-divider" aria-hidden />
            <div className="status-bar-metrics" data-testid="status-bar-metrics">
              {metrics.map((metric) => (
                <span
                  className="status-bar-metric"
                  data-kind={metric.id}
                  data-testid={`status-bar-metric-${metric.id}`}
                  aria-label={`${metric.label} ${metric.value}`}
                  key={metric.id}
                >
                  <span className="status-bar-metric-icon">
                    <MetricIcon id={metric.id} />
                  </span>
                  <span className="status-bar-metric-label">{metric.label}</span>
                  <strong className="status-bar-metric-value">{metric.value}</strong>
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </footer>
  );
}
