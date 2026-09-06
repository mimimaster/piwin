/**
 * Settings → Session Runtime page (spec §12.5 + ADR 0040).
 *
 * Shows:
 * - Settings staleness (live/stale/rebuilding/failed) for the active session
 * - Host-owned residency (Cold / Starting / Ready / Busy / Suspending)
 * - Retention budgets (idle TTL, idle count, optional resident cap, optional
 *   memory high water). Desktop only edits policy; the Host owns timers,
 *   LRU, and memory thresholds.
 * - Aggregate Host resource metrics (query-only).
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  ABSOLUTE_MAX_RESIDENT_RUNTIMES,
  DEFAULT_IDLE_TTL_SECONDS,
  DEFAULT_MAX_CONCURRENT_RUNS,
  DEFAULT_MAX_IDLE_RUNTIMES,
  MAX_CONCURRENT_RUNS,
  MAX_MEMORY_HIGH_WATER_MIB,
  MIN_MEMORY_HIGH_WATER_MIB,
  normalizeExecutionConfig,
  normalizeSessionRuntimeRetentionConfig,
  type HostRuntimeResourcesData,
  type PiwinConfig,
  type SessionRuntimeEvictionReason,
  type SessionRuntimeResidency,
  type SessionRuntimeRetentionConfig,
  type SessionRuntimeStatus,
} from '@piwin/contracts';
import { Button, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { SettingsHostLogSection } from '../settings-host-log';
import { settingsHostSupportsCommand, useSettings } from '../settings-context';

function residencyLabel(residency: SessionRuntimeResidency | undefined, isZh: boolean): string {
  switch (residency) {
    case 'activating':
      return isZh ? '启动中（Starting）' : 'Starting';
    case 'resident-idle':
      return isZh ? '就绪（Ready）' : 'Ready';
    case 'resident-busy':
      return isZh ? '忙碌（Busy）' : 'Busy';
    case 'suspending':
      return isZh ? '挂起中（Suspending）' : 'Suspending';
    case 'cold':
    case undefined:
      // Host projects cold for history-only sessions; treat missing as cold so
      // diagnostics never show a vague "Unknown" for a normal cold session.
      return isZh ? '冷态（Cold）' : 'Cold';
    default:
      return isZh ? '未知' : 'Unknown';
  }
}

function evictionReasonLabel(
  reason: SessionRuntimeEvictionReason | undefined,
  isZh: boolean,
): string | null {
  if (!reason) return null;
  const labels: Record<SessionRuntimeEvictionReason, { zh: string; en: string }> = {
    'idle-ttl': { zh: '空闲超时', en: 'Idle TTL' },
    'max-idle': { zh: '空闲数量上限', en: 'Max idle' },
    'max-resident': { zh: '驻留数量上限', en: 'Max resident' },
    'memory-pressure': { zh: '内存压力', en: 'Memory pressure' },
    manual: { zh: '手动', en: 'Manual' },
    'host-dispose': { zh: 'Host 释放', en: 'Host dispose' },
    'branch-switch': { zh: '切换分支', en: 'Branch switch' },
  };
  const entry = labels[reason];
  return isZh ? entry.zh : entry.en;
}

function parseOptionalPositiveInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function parseNonNegativeInt(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

/** Pure retention draft builder (exported for unit tests). */
export function buildSessionRuntimeRetentionDraft(input: {
  idleTtlDraft: string;
  maxIdleDraft: string;
  maxResidentDraft: string;
  memoryHighWaterDraft: string;
}): SessionRuntimeRetentionConfig {
  const draft: SessionRuntimeRetentionConfig = {
    idleTtlSeconds: parseNonNegativeInt(input.idleTtlDraft, DEFAULT_IDLE_TTL_SECONDS),
    maxIdleRuntimes: parseNonNegativeInt(input.maxIdleDraft, DEFAULT_MAX_IDLE_RUNTIMES),
  };
  const maxResident = parseOptionalPositiveInt(input.maxResidentDraft);
  if (maxResident !== undefined) {
    draft.maxResidentRuntimes = Math.min(maxResident, ABSOLUTE_MAX_RESIDENT_RUNTIMES);
  }
  const memoryHighWater = parseOptionalPositiveInt(input.memoryHighWaterDraft);
  if (memoryHighWater !== undefined) {
    draft.memoryHighWaterMiB = Math.min(
      Math.max(memoryHighWater, MIN_MEMORY_HIGH_WATER_MIB),
      MAX_MEMORY_HIGH_WATER_MIB,
    );
  }
  return normalizeSessionRuntimeRetentionConfig(draft);
}

export function SessionRuntimePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const settings = useSettings();
  const { request, hostClient, activeSessionId, config, saveConfig, setInfo, saving } = settings;
  const canReadRuntimeResources = settingsHostSupportsCommand(settings, 'host/runtime-resources');
  const canReadRuntimeStatus = settingsHostSupportsCommand(settings, 'session/runtime-status');
  const [runtimeStatus, setRuntimeStatus] = useState<SessionRuntimeStatus | null>(null);
  const [resources, setResources] = useState<HostRuntimeResourcesData | null>(null);
  const [retryingRuntime, setRetryingRuntime] = useState(false);

  const savedRetention = useMemo(
    () => normalizeSessionRuntimeRetentionConfig(config?.session?.runtimeRetention),
    [config?.session?.runtimeRetention],
  );
  const savedExecution = useMemo(
    () => normalizeExecutionConfig(config?.execution),
    [config?.execution],
  );

  const [idleTtlDraft, setIdleTtlDraft] = useState(String(savedRetention.idleTtlSeconds));
  const [maxIdleDraft, setMaxIdleDraft] = useState(String(savedRetention.maxIdleRuntimes));
  const [maxResidentDraft, setMaxResidentDraft] = useState(
    savedRetention.maxResidentRuntimes !== undefined
      ? String(savedRetention.maxResidentRuntimes)
      : '',
  );
  const [memoryHighWaterDraft, setMemoryHighWaterDraft] = useState(
    savedRetention.memoryHighWaterMiB !== undefined
      ? String(savedRetention.memoryHighWaterMiB)
      : '',
  );
  const [maxConcurrentDraft, setMaxConcurrentDraft] = useState(
    String(savedExecution.maxConcurrentRuns),
  );

  useEffect(() => {
    setIdleTtlDraft(String(savedRetention.idleTtlSeconds));
    setMaxIdleDraft(String(savedRetention.maxIdleRuntimes));
    setMaxResidentDraft(
      savedRetention.maxResidentRuntimes !== undefined
        ? String(savedRetention.maxResidentRuntimes)
        : '',
    );
    setMemoryHighWaterDraft(
      savedRetention.memoryHighWaterMiB !== undefined
        ? String(savedRetention.memoryHighWaterMiB)
        : '',
    );
  }, [savedRetention]);

  useEffect(() => {
    setMaxConcurrentDraft(String(savedExecution.maxConcurrentRuns));
  }, [savedExecution]);

  const draftRetention: SessionRuntimeRetentionConfig = useMemo(
    () =>
      buildSessionRuntimeRetentionDraft({
        idleTtlDraft,
        maxIdleDraft,
        maxResidentDraft,
        memoryHighWaterDraft,
      }),
    [idleTtlDraft, maxIdleDraft, maxResidentDraft, memoryHighWaterDraft],
  );

  const retentionDirty =
    draftRetention.idleTtlSeconds !== savedRetention.idleTtlSeconds ||
    draftRetention.maxIdleRuntimes !== savedRetention.maxIdleRuntimes ||
    draftRetention.maxResidentRuntimes !== savedRetention.maxResidentRuntimes ||
    draftRetention.memoryHighWaterMiB !== savedRetention.memoryHighWaterMiB;

  const draftExecution = useMemo(
    () =>
      normalizeExecutionConfig({
        maxConcurrentRuns: parseNonNegativeInt(maxConcurrentDraft, DEFAULT_MAX_CONCURRENT_RUNS),
      }),
    [maxConcurrentDraft],
  );
  const executionDirty = draftExecution.maxConcurrentRuns !== savedExecution.maxConcurrentRuns;

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!canReadRuntimeStatus) {
      setRuntimeStatus(null);
      return;
    }
    if (!activeSessionId) {
      setRuntimeStatus(null);
      return;
    }
    const response = await request({
      type: 'session/runtime-status',
      sessionId: activeSessionId,
    });
    if (!response.success) {
      setRuntimeStatus(null);
      return;
    }
    const data = response.data as { status?: SessionRuntimeStatus };
    setRuntimeStatus(data.status ?? null);
  }, [activeSessionId, canReadRuntimeStatus, request]);

  const refreshResources = useCallback(async (): Promise<void> => {
    if (!canReadRuntimeResources) {
      setResources(null);
      return;
    }
    const response = await request({ type: 'host/runtime-resources' });
    if (!response.success) {
      setResources(null);
      return;
    }
    setResources(response.data as HostRuntimeResourcesData);
  }, [canReadRuntimeResources, request]);

  useEffect(() => {
    if (!activeSessionId) {
      setRuntimeStatus(null);
      return;
    }

    const unsubscribe = hostClient?.subscribe((message) => {
      if (
        message.type === 'session/runtime-updated' &&
        message.status.sessionId === activeSessionId
      ) {
        setRuntimeStatus(message.status);
      }
    });
    void refreshStatus();
    return () => unsubscribe?.();
  }, [activeSessionId, hostClient, refreshStatus]);

  useEffect(() => {
    void refreshResources();
  }, [refreshResources]);

  async function handleSaveRetention(): Promise<void> {
    if (!config) return;
    const next: PiwinConfig = {
      ...config,
      session: {
        ...(config.session ?? { autoName: true }),
        runtimeRetention: draftRetention,
      },
    };
    if (await saveConfig(next)) {
      setInfo(
        isZh
          ? '已保存运行时驻留策略。Host 将按新预算执行挂起。'
          : 'Runtime retention policy saved. The Host applies the new budgets.',
      );
      void refreshResources();
    } else {
      setInfo(isZh ? '保存失败：无法写入配置文件。' : 'Save failed: could not write config.');
    }
  }

  async function handleSaveExecution(): Promise<void> {
    if (!config) return;
    const next: PiwinConfig = {
      ...config,
      execution: draftExecution,
    };
    if (await saveConfig(next)) {
      setInfo(
        isZh
          ? '已保存并发任务上限。正在运行的任务将继续执行，不会被强制终止。'
          : 'Concurrent run limit saved. Active runs are not killed.',
      );
      void refreshResources();
    } else {
      setInfo(isZh ? '保存失败：无法写入配置文件。' : 'Save failed: could not write config.');
    }
  }

  async function handleRetryRuntime(): Promise<void> {
    if (!activeSessionId || !runtimeStatus?.settingsRevision) return;
    setRetryingRuntime(true);
    try {
      const response = await request({
        type: 'session/reload-runtime',
        sessionId: activeSessionId,
        expectedSettingsRevision: runtimeStatus.settingsRevision,
        when: 'after-current-run',
      });
      if (response.success) {
        setInfo(isZh ? '已重新提交运行时更新。' : 'Runtime update retry submitted.', 'info');
      } else {
        setInfo(
          isZh
            ? `运行时更新重试失败：${response.error}`
            : `Runtime retry failed: ${response.error}`,
          'warning',
        );
      }
      await refreshStatus();
    } finally {
      setRetryingRuntime(false);
    }
  }

  const stale = runtimeStatus?.state === 'stale';
  const rebuilding = runtimeStatus?.state === 'rebuilding';
  const failed = runtimeStatus?.state === 'failed';
  const stateLabel =
    runtimeStatus === null
      ? isZh
        ? '无活动会话'
        : 'No active session'
      : runtimeStatus.state === 'stale'
        ? isZh
          ? '待更新（Stale）'
          : 'Stale'
        : runtimeStatus.state === 'rebuilding'
          ? isZh
            ? '重建中（Rebuilding）'
            : 'Rebuilding'
          : runtimeStatus.state === 'failed'
            ? isZh
              ? '重建失败（Failed）'
              : 'Failed'
            : runtimeStatus.state === 'live'
              ? isZh
                ? '运行中（Live）'
                : 'Live'
              : isZh
                ? '轻量外壳（Lazy shell）'
                : 'Lazy shell';

  const residencyValue = runtimeStatus?.residency;
  const evictionLabel = evictionReasonLabel(runtimeStatus?.lastEvictionReason, isZh);

  return (
    <div className="settings-card">
      <div className="settings-section settings-section-card" data-testid="session-runtime-section">
        <div className="ui-field-row" data-testid="runtime-state-row">
          <span className="muted">{isZh ? '设置状态' : 'Settings state'}:</span>
          <strong data-testid="runtime-state-value">{stateLabel}</strong>
        </div>

        <div className="ui-field-row" data-testid="runtime-residency-row">
          <span className="muted">{isZh ? '驻留状态' : 'Residency'}:</span>
          <strong data-testid="runtime-residency-value">
            {runtimeStatus === null
              ? isZh
                ? '无活动会话'
                : 'No active session'
              : residencyLabel(residencyValue, isZh)}
          </strong>
        </div>

        {runtimeStatus?.generationId ? (
          <div className="ui-field-row">
            <span className="muted">{isZh ? '运行时版本' : 'Generation'}:</span>
            <code data-testid="runtime-generation-id">{runtimeStatus.generationId}</code>
          </div>
        ) : null}

        {runtimeStatus?.desiredSettingsRevision ? (
          <div className="ui-field-row" data-testid="runtime-desired-revision-row">
            <span className="muted">{isZh ? '目标设置版本' : 'Desired settings'}:</span>
            <code data-testid="runtime-desired-revision">
              {runtimeStatus.desiredSettingsRevision}
            </code>
          </div>
        ) : null}

        {evictionLabel ? (
          <div className="ui-field-row" data-testid="runtime-eviction-row">
            <span className="muted">{isZh ? '上次置换原因' : 'Last eviction'}:</span>
            <span data-testid="runtime-eviction-value">{evictionLabel}</span>
          </div>
        ) : null}

        {stale || rebuilding || failed ? (
          <div
            className={`settings-notice settings-notice--${failed ? 'error' : 'warning'}`}
            data-testid={failed ? 'runtime-failed-bar' : 'pending-changes-bar'}
          >
            <p>
              {failed
                ? isZh
                  ? '运行时重建失败，当前会话仍保留旧运行时。'
                  : 'Runtime rebuild failed; the current session is still using its previous runtime.'
                : rebuilding
                  ? isZh
                    ? '运行时正在重建，旧运行时仍负责当前调用。'
                    : 'Runtime is rebuilding; the previous runtime remains responsible for current calls.'
                  : isZh
                    ? '设置已保存，但当前 Agent 仍在使用旧的运行时 schema。'
                    : 'Settings are saved, but the current Agent still uses the previous runtime schema.'}
            </p>
            {runtimeStatus.candidateError ? (
              <p className="muted" data-testid="runtime-candidate-error">
                {runtimeStatus.candidateError}
              </p>
            ) : null}
            {runtimeStatus.staleDomains.length > 0 ? (
              <p className="muted">
                {isZh ? '受影响设置：' : 'Affected settings: '}
                {runtimeStatus.staleDomains.join(', ')}
              </p>
            ) : null}
            {runtimeStatus.immediateRestrictions?.length ? (
              <p className="muted" data-testid="runtime-immediate-restrictions">
                {isZh ? '即时限制：' : 'Immediate restrictions: '}
                {runtimeStatus.immediateRestrictions.join(', ')}
              </p>
            ) : null}
            {failed ? (
              <Button
                data-testid="runtime-retry-button"
                variant="secondary"
                disabled={retryingRuntime}
                onClick={() => void handleRetryRuntime()}
              >
                {retryingRuntime
                  ? isZh
                    ? '重试中…'
                    : 'Retrying…'
                  : isZh
                    ? '重试更新'
                    : 'Retry update'}
              </Button>
            ) : null}
            <p className="muted" data-testid="runtime-reload-unavailable-note">
              {isZh
                ? failed
                  ? '请检查错误后重试运行时更新；新消息不会静默使用旧配置。'
                  : '高危安全限制将立即生效；其余常规设置将在当前任务执行完成后自动应用。'
                : failed
                  ? 'Retry the runtime update after resolving the error; new prompts will not silently use stale configuration.'
                  : 'The Host applies the latest settings after the current Run; genuine safety tightening takes effect immediately.'}
            </p>
          </div>
        ) : (
          <p className="muted" data-testid="runtime-fresh-note">
            {isZh
              ? '当前 Agent 已应用最新配置。已转储会话仍可浏览历史记录；发送新消息时将自动恢复运行时。'
              : 'The current Agent matches the latest settings. Cold sessions keep history usable; the Host reactivates the runtime on the next prompt.'}
          </p>
        )}
      </div>

      <div
        className="settings-section settings-section-card"
        data-testid="execution-admission-section"
      >
        <h3 className="settings-section-title">{isZh ? '同时执行任务数' : 'Concurrent runs'}</h3>
        <p className="muted">
          {isZh
            ? '限制同时调用模型与工具的并发操作数，而非限制会话数或 Worker 进程数。'
            : 'Caps simultaneous model/tool leaf tasks — not session count, and not workers.'}
        </p>
        <FieldRow
          label={isZh ? '同时执行任务数' : 'Max concurrent runs'}
          description={
            isZh
              ? `默认 ${DEFAULT_MAX_CONCURRENT_RUNS}，范围 1–${MAX_CONCURRENT_RUNS}。调低上限不会强制终止正在运行的任务。`
              : `Default ${DEFAULT_MAX_CONCURRENT_RUNS}, range 1–${MAX_CONCURRENT_RUNS}. Lowering the cap does not kill active runs.`
          }
          testId="execution-max-concurrent-row"
        >
          <TextInput
            testId="execution-max-concurrent"
            type="number"
            min={1}
            max={MAX_CONCURRENT_RUNS}
            value={maxConcurrentDraft}
            onChange={(event) => setMaxConcurrentDraft(event.currentTarget.value)}
          />
        </FieldRow>
        <div className="ui-field-row">
          <Button
            data-testid="execution-max-concurrent-save"
            disabled={!executionDirty || saving || !config}
            onClick={() => {
              void handleSaveExecution();
            }}
          >
            {isZh ? '保存同时执行任务数' : 'Save concurrent run limit'}
          </Button>
        </div>
      </div>

      <div
        className="settings-section settings-section-card"
        data-testid="runtime-retention-section"
      >
        <h3 className="settings-section-title">
          {isZh ? '驻留预算（Host 策略）' : 'Residency budgets (Host policy)'}
        </h3>
        <p className="muted" data-testid="runtime-retention-host-owns-note">
          {isZh
            ? 'Desktop 只编辑策略；计时、LRU 与内存阈值由 Host 执行，客户端不维护本地计时器。'
            : 'Desktop only edits policy. Timers, LRU, and memory thresholds are Host-owned — clients never run a local eviction clock.'}
        </p>

        <FieldRow
          label={isZh ? '空闲保留（秒）' : 'Idle TTL (seconds)'}
          description={
            isZh
              ? `默认 ${DEFAULT_IDLE_TTL_SECONDS}。0 表示空闲后不保留运行时。`
              : `Default ${DEFAULT_IDLE_TTL_SECONDS}. Zero means do not retain an idle runtime.`
          }
          testId="runtime-retention-idle-ttl-row"
        >
          <TextInput
            testId="runtime-retention-idle-ttl"
            type="number"
            min={0}
            value={idleTtlDraft}
            onChange={(event) => setIdleTtlDraft(event.currentTarget.value)}
          />
        </FieldRow>

        <FieldRow
          label={isZh ? '最大空闲运行时数' : 'Max idle runtimes'}
          description={
            isZh
              ? `默认 ${DEFAULT_MAX_IDLE_RUNTIMES}。超出部分将按最久未使用原则（LRU）优先置换休眠。`
              : `Default ${DEFAULT_MAX_IDLE_RUNTIMES}. Idle runtimes above this count become LRU victims immediately.`
          }
          testId="runtime-retention-max-idle-row"
        >
          <TextInput
            testId="runtime-retention-max-idle"
            type="number"
            min={0}
            value={maxIdleDraft}
            onChange={(event) => setMaxIdleDraft(event.currentTarget.value)}
          />
        </FieldRow>

        <FieldRow
          label={isZh ? '最大驻留运行时数（可选）' : 'Max resident runtimes (optional)'}
          description={
            isZh
              ? `留空表示自适应（不超过 ${ABSOLUTE_MAX_RESIDENT_RUNTIMES}）。`
              : `Leave empty for adaptive (ceiling ${ABSOLUTE_MAX_RESIDENT_RUNTIMES}).`
          }
          testId="runtime-retention-max-resident-row"
        >
          <TextInput
            testId="runtime-retention-max-resident"
            type="number"
            min={1}
            max={ABSOLUTE_MAX_RESIDENT_RUNTIMES}
            placeholder={isZh ? '自适应' : 'Adaptive'}
            value={maxResidentDraft}
            onChange={(event) => setMaxResidentDraft(event.currentTarget.value)}
          />
        </FieldRow>

        <FieldRow
          label={isZh ? '内存高水位 MiB（可选）' : 'Memory high water MiB (optional)'}
          description={
            isZh
              ? `留空表示自适应（${MIN_MEMORY_HIGH_WATER_MIB}–${MAX_MEMORY_HIGH_WATER_MIB} MiB）。`
              : `Leave empty for adaptive (${MIN_MEMORY_HIGH_WATER_MIB}–${MAX_MEMORY_HIGH_WATER_MIB} MiB).`
          }
          testId="runtime-retention-memory-row"
        >
          <TextInput
            testId="runtime-retention-memory-high-water"
            type="number"
            min={MIN_MEMORY_HIGH_WATER_MIB}
            max={MAX_MEMORY_HIGH_WATER_MIB}
            placeholder={isZh ? '自适应' : 'Adaptive'}
            value={memoryHighWaterDraft}
            onChange={(event) => setMemoryHighWaterDraft(event.currentTarget.value)}
          />
        </FieldRow>

        <div className="ui-field-row">
          <Button
            data-testid="runtime-retention-save"
            disabled={!retentionDirty || saving || !config}
            onClick={() => {
              void handleSaveRetention();
            }}
          >
            {isZh ? '保存驻留策略' : 'Save retention policy'}
          </Button>
        </div>
      </div>

      {resources ? (
        <div
          className="settings-section settings-section-card"
          data-testid="runtime-resources-section"
        >
          <h3 className="settings-section-title">
            {isZh ? 'Host 资源（聚合）' : 'Host resources (aggregate)'}
          </h3>
          <p className="muted" data-testid="runtime-resources-snapshot-note">
            {isZh
              ? '查询快照；不会在客户端做定时采样。需要最新数据时点刷新。'
              : 'Query snapshot only — clients do not poll on a timer. Refresh for a fresh sample.'}
          </p>
          <div className="ui-field-row" data-testid="runtime-resources-counts">
            <span className="muted">{isZh ? '驻留' : 'Resident'}:</span>
            <span>
              {resources.counts.resident} ({isZh ? '空闲' : 'idle'} {resources.counts.idle} ·{' '}
              {isZh ? '忙碌' : 'busy'} {resources.counts.busy} · {isZh ? '启动' : 'starting'}{' '}
              {resources.counts.activating} · {isZh ? '挂起' : 'suspending'}{' '}
              {resources.counts.suspending})
            </span>
          </div>
          <div className="ui-field-row" data-testid="runtime-resources-execution">
            <span className="muted">{isZh ? '执行' : 'Execution'}:</span>
            <span data-testid="runtime-resources-execution-counts">
              {isZh ? '运行中' : 'running'} {resources.execution.activeRuns} /{' '}
              {resources.execution.effectiveMaxConcurrentRuns} · {isZh ? '排队' : 'queued'}{' '}
              {resources.execution.waitingRuns}
            </span>
          </div>
          {resources.execution.limitingReason === 'runtime-residency' ? (
            <p className="muted" data-testid="runtime-resources-execution-limit-reason">
              {isZh
                ? `配置 ${resources.execution.configuredMaxConcurrentRuns}，因运行时驻留限制实际为 ${resources.execution.effectiveMaxConcurrentRuns}`
                : `Configured ${resources.execution.configuredMaxConcurrentRuns}, limited to ${resources.execution.effectiveMaxConcurrentRuns} by runtime residency`}
            </p>
          ) : null}
          <div className="ui-field-row">
            <span className="muted">{isZh ? '排队请求' : 'Waiters'}:</span>
            <span data-testid="runtime-resources-waiters">{resources.waiterCount}</span>
          </div>
          {resources.workers ? (
            <div className="ui-field-row" data-testid="runtime-resources-workers">
              <span className="muted">{isZh ? 'Worker 进程' : 'Workers'}:</span>
              <span>
                {resources.workers.active}/{resources.workers.pool}
                {' · '}
                {isZh ? '子代理' : 'subagents'} {resources.workers.subagent}/
                {resources.workers.subagentMax}
                {' · '}
                {isZh ? '排队' : 'waiting'} {resources.workers.subagentWaiting}
              </span>
            </div>
          ) : null}
          <div className="ui-field-row">
            <span className="muted">{isZh ? '预算' : 'Budget'}:</span>
            <span data-testid="runtime-resources-budget">
              maxResident={resources.budget.maxResidentRuntimes} · maxIdle=
              {resources.budget.maxIdleRuntimes} · highWater=
              {resources.budget.memoryHighWaterMiB} MiB
            </span>
          </div>
          <div className="ui-field-row">
            <span className="muted">{isZh ? 'RSS' : 'RSS'}:</span>
            <span data-testid="runtime-resources-memory">
              host={resources.memory.hostRssMiB} MiB
              {resources.memory.workerRssMiB !== undefined
                ? ` · worker=${resources.memory.workerRssMiB} MiB`
                : ''}{' '}
              ({resources.memory.sampleCompleteness})
            </span>
          </div>
          <div className="ui-field-row">
            <span className="muted">{isZh ? '置换次数' : 'Evictions'}:</span>
            <span data-testid="runtime-resources-counters">
              ttl={resources.counters.evictedByIdleTtl} · idle=
              {resources.counters.evictedByMaxIdle} · resident=
              {resources.counters.evictedByMaxResident} · memory=
              {resources.counters.evictedByMemoryPressure} · pressureFail=
              {resources.counters.memoryPressureFailures}
            </span>
          </div>
          <div className="ui-field-row">
            <Button
              data-testid="runtime-resources-refresh"
              onClick={() => {
                void refreshResources();
              }}
            >
              {isZh ? '刷新' : 'Refresh'}
            </Button>
          </div>
        </div>
      ) : null}
      <SettingsHostLogSection />
    </div>
  );
}
