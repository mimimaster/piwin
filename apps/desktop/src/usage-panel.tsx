/**
 * Token usage statistics panel (CE-OBS).
 * Renders the usage/get-rollup payload: totals, per-model split, per-day
 * trend bars, and a per-session breakdown. Scope switches between the current
 * project and global. No cost estimation — token counts only.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { HostResponse, UsageRollup, UsageSessionTotal } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';

export type UsagePanelProps = {
  /** Current trusted project path; null when no project is open. */
  projectPath: string | null;
  request: (command: {
    type: 'usage/get-rollup';
    projectPath?: string;
    scope?: { kind: 'general' };
    window?: { from?: string; to?: string };
    topSessions?: number;
  }) => Promise<HostResponse>;
  /** Open a session from the breakdown list (resume). */
  onOpenSession?: (sessionId: string) => void;
};

type ScopeMode = 'project' | 'global';
type TimeRange = 'all' | 'today' | '7d' | '30d';

function resolveWindow(range: TimeRange): { from?: string; to?: string } | undefined {
  if (range === 'all') return undefined;
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  let fromMs: number;
  if (range === 'today') {
    fromMs = startOfToday.getTime();
  } else {
    fromMs = now - (range === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;
  }
  return { from: new Date(fromMs).toISOString() };
}

/** Derive a provider label from a model id ("provider/model" or "provider::model"). */
function providerOfModel(modelId: string): string {
  const slash = modelId.indexOf('/');
  if (slash > 0) return modelId.slice(0, slash);
  const sep = modelId.indexOf('::');
  if (sep > 0) return modelId.slice(0, sep);
  return modelId;
}

const EMPTY_ROLLUP: UsageRollup = {
  scope: { kind: 'global' },
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  entryCount: 0,
  sessionCount: 0,
  firstAt: null,
  lastAt: null,
  byModel: {},
  byDay: {},
  bySession: [],
};

function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

function formatFull(value: number): string {
  return value.toLocaleString('en-US');
}

export function UsagePanel(props: UsagePanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [scopeMode, setScopeMode] = useState<ScopeMode>(props.projectPath ? 'project' : 'global');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [rollup, setRollup] = useState<UsageRollup>(EMPTY_ROLLUP);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const scope =
      scopeMode === 'global'
        ? { kind: 'global' as const }
        : props.projectPath
          ? { kind: 'project' as const, projectPath: props.projectPath }
          : { kind: 'global' as const };
    const window = resolveWindow(timeRange);
    const response = await props.request({
      type: 'usage/get-rollup',
      ...(scope.kind === 'project' ? { projectPath: scope.projectPath } : {}),
      ...(window ? { window } : {}),
      topSessions: 20,
    });
    setLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { rollup?: UsageRollup };
    setRollup(data.rollup ?? EMPTY_ROLLUP);
  }, [props.request, scopeMode, props.projectPath, timeRange]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxDayTokens = Math.max(1, ...Object.values(rollup.byDay).map((day) => day.totalTokens));
  const days = Object.entries(rollup.byDay).sort(([a], [b]) => a.localeCompare(b));

  // Provider grouping derived from model ids ("provider/model" or "provider::model").
  const byProvider = new Map<
    string,
    { promptTokens: number; completionTokens: number; totalTokens: number; models: Set<string> }
  >();
  for (const [modelId, bucket] of Object.entries(rollup.byModel)) {
    const provider = providerOfModel(modelId);
    const entry = byProvider.get(provider) ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      models: new Set<string>(),
    };
    entry.promptTokens += bucket.promptTokens;
    entry.completionTokens += bucket.completionTokens;
    entry.totalTokens += bucket.totalTokens;
    entry.models.add(modelId);
    byProvider.set(provider, entry);
  }
  const providers = [...byProvider.entries()].sort(([, a], [, b]) => b.totalTokens - a.totalTokens);

  const scopeLabel = isZh
    ? scopeMode === 'project'
      ? '当前项目'
      : '全局'
    : scopeMode === 'project'
      ? 'Current project'
      : 'Global';

  return (
    <section className="usage-panel" data-testid="usage-panel" data-scope={scopeMode}>
      <header className="usage-panel-header">
        <div
          className="usage-panel-scope-switch"
          role="group"
          aria-label={isZh ? '统计范围' : 'Scope'}
        >
          {(['project', 'global'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={scopeMode === mode ? 'active' : ''}
              disabled={mode === 'project' && !props.projectPath}
              onClick={() => setScopeMode(mode)}
              data-testid={`usage-scope-${mode}`}
            >
              {mode === 'project' ? (isZh ? '项目' : 'Project') : isZh ? '全局' : 'Global'}
            </button>
          ))}
        </div>
        <div
          className="usage-panel-scope-switch"
          role="group"
          aria-label={isZh ? '时间范围' : 'Time range'}
        >
          {(
            [
              ['all', isZh ? '全部' : 'All'],
              ['today', isZh ? '今天' : 'Today'],
              ['7d', isZh ? '7天' : '7d'],
              ['30d', isZh ? '30天' : '30d'],
            ] as const
          ).map(([range, label]) => (
            <button
              key={range}
              type="button"
              className={timeRange === range ? 'active' : ''}
              onClick={() => setTimeRange(range)}
              data-testid={`usage-range-${range}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="compact" onClick={() => void load()} disabled={loading}>
          {loading ? (isZh ? '加载中…' : 'Loading…') : isZh ? '刷新' : 'Refresh'}
        </Button>
      </header>

      {error ? (
        <div className="usage-panel-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="usage-panel-body">
        <div className="usage-kpis">
          <div className="usage-kpi">
            <span className="usage-kpi-label">{isZh ? '总 Tokens' : 'Total tokens'}</span>
            <span className="usage-kpi-value" data-testid="usage-total">
              {formatNumber(rollup.totalTokens)}
            </span>
          </div>
          <div className="usage-kpi">
            <span className="usage-kpi-label">{isZh ? '输入' : 'Input'}</span>
            <span className="usage-kpi-value">{formatNumber(rollup.promptTokens)}</span>
          </div>
          <div className="usage-kpi">
            <span className="usage-kpi-label">{isZh ? '输出' : 'Output'}</span>
            <span className="usage-kpi-value">{formatNumber(rollup.completionTokens)}</span>
          </div>
          <div className="usage-kpi">
            <span className="usage-kpi-label">{isZh ? '会话数' : 'Sessions'}</span>
            <span className="usage-kpi-value">{rollup.sessionCount}</span>
          </div>
        </div>

        <div className="usage-panel-meta">
          <span>{scopeLabel}</span>
          <span>
            {formatFull(rollup.totalTokens)} {isZh ? '总 tokens' : 'tokens'} · {rollup.entryCount}{' '}
            {isZh ? '轮' : 'turns'}
          </span>
          {rollup.firstAt ? (
            <span>
              {rollup.firstAt.slice(0, 10)} → {rollup.lastAt?.slice(0, 10) ?? ''}
            </span>
          ) : null}
        </div>

        {rollup.entryCount === 0 && !loading ? (
          <div className="right-panel-empty">
            {isZh
              ? '还没有 token 使用记录。运行几次会话后这里会显示统计。'
              : 'No token usage yet. Run a few sessions to populate stats.'}
          </div>
        ) : null}

        {days.length > 0 ? (
          <section className="usage-section">
            <h4 className="usage-section-title">{isZh ? '按天趋势' : 'By day'}</h4>
            <div className="usage-day-bars" data-testid="usage-day-bars">
              {days.map(([day, bucket]) => (
                <div
                  key={day}
                  className="usage-day-bar"
                  title={`${day}: ${formatFull(bucket.totalTokens)}`}
                >
                  <div
                    className="usage-day-bar-fill"
                    style={{
                      height: `${Math.max(3, Math.round((bucket.totalTokens / maxDayTokens) * 100))}%`,
                    }}
                  />
                  <span className="usage-day-bar-label">{day.slice(5)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {providers.length > 0 ? (
          <section className="usage-section">
            <h4 className="usage-section-title">{isZh ? '按提供商' : 'By provider'}</h4>
            <table className="usage-table">
              <thead>
                <tr>
                  <th>{isZh ? '提供商' : 'Provider'}</th>
                  <th>{isZh ? '模型数' : 'Models'}</th>
                  <th>{isZh ? '输入' : 'In'}</th>
                  <th>{isZh ? '输出' : 'Out'}</th>
                  <th>{isZh ? '总计' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>
                {providers.map(([provider, entry]) => (
                  <tr key={provider}>
                    <td className="usage-table-model">{provider}</td>
                    <td>{entry.models.size}</td>
                    <td>{formatNumber(entry.promptTokens)}</td>
                    <td>{formatNumber(entry.completionTokens)}</td>
                    <td>{formatNumber(entry.totalTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {Object.keys(rollup.byModel).length > 0 ? (
          <section className="usage-section">
            <h4 className="usage-section-title">{isZh ? '按模型' : 'By model'}</h4>
            <table className="usage-table">
              <thead>
                <tr>
                  <th>{isZh ? '模型' : 'Model'}</th>
                  <th>{isZh ? '输入' : 'In'}</th>
                  <th>{isZh ? '输出' : 'Out'}</th>
                  <th>{isZh ? '总计' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(rollup.byModel)
                  .sort(([, a], [, b]) => b.totalTokens - a.totalTokens)
                  .map(([modelId, bucket]) => (
                    <tr key={modelId}>
                      <td className="usage-table-model">{modelId}</td>
                      <td>{formatNumber(bucket.promptTokens)}</td>
                      <td>{formatNumber(bucket.completionTokens)}</td>
                      <td>{formatNumber(bucket.totalTokens)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {rollup.bySession.length > 0 ? (
          <section className="usage-section">
            <h4 className="usage-section-title">{isZh ? '按会话' : 'By session'}</h4>
            <ul className="usage-session-list">
              {rollup.bySession.map((session: UsageSessionTotal) => (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    className="usage-session-row"
                    onClick={() => props.onOpenSession?.(session.sessionId)}
                    disabled={!props.onOpenSession}
                  >
                    <span className="usage-session-id">{session.sessionId.slice(0, 8)}</span>
                    <span className="usage-session-bucket">
                      <span className="usage-session-total">
                        {formatNumber(session.totalTokens)}
                      </span>
                      <span className="usage-session-inout">
                        ↑{formatNumber(session.promptTokens)} ↓
                        {formatNumber(session.completionTokens)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </section>
  );
}
