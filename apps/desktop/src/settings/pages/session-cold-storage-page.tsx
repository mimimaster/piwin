/**
 * Settings → Cold storage (R1 PR4).
 *
 * Config + Host status/plan/execute + pack list/import/reconcile.
 * Execute stays disabled until the saved config is valid and a plan digest exists.
 * No schedule / dry-run / include-media / force-replace controls.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  SessionColdStorageExecuteResult,
  SessionColdStoragePlan,
  SessionColdStorageReconcileResult,
  SessionColdStorageRestoreResult,
  SessionColdStorageStatus,
  SessionPackListData,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { Button, Switch, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';
import {
  coldStorageDraftDirty,
  coldStorageToDraft,
  draftToColdStorage,
  type SessionColdStorageDraft,
} from '../cold-storage-draft';
import { canExecuteColdStoragePlan } from '../../session-storage-ui';
import { chooseHostDirectory, chooseSessionPackPath } from '../../session-pack-dialog';

export function SessionColdStoragePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { config, saveConfig, setError, setInfo, request, saving } = useSettings();
  const saved = config?.session?.coldStorage;
  const [draft, setDraft] = useState<SessionColdStorageDraft>(() => coldStorageToDraft(saved));
  const [status, setStatus] = useState<SessionColdStorageStatus | null>(null);
  const [plan, setPlan] = useState<SessionColdStoragePlan | null>(null);
  const [packs, setPacks] = useState<SessionPackListData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setDraft(coldStorageToDraft(saved));
  }, [saved]);

  const dirty = useMemo(() => coldStorageDraftDirty(draft, saved), [draft, saved]);
  const canExecute = canExecuteColdStoragePlan({
    enabled: saved?.enabled === true,
    packOutputDir: saved?.packOutputDir ?? '',
    draftDirty: dirty,
    plan,
  });

  async function handleSave(): Promise<void> {
    if (!config) return;
    const next = {
      ...config,
      session: {
        ...config.session,
        coldStorage: draftToColdStorage(draft),
      },
    };
    if (await saveConfig(next)) {
      setPlan(null);
      setInfo(isZh ? '已保存冷存储设置。' : 'Cold storage settings saved.');
    } else {
      setInfo(isZh ? '保存失败：无法写入配置文件。' : 'Save failed: could not write config.');
    }
  }

  async function refreshStatus(): Promise<void> {
    setBusy('status');
    setError(null);
    try {
      const response = await request({ type: 'session/cold-storage-status' });
      if (!response.success) {
        setError(response.error);
        return;
      }
      setStatus(response.data as SessionColdStorageStatus);
    } catch (error) {
      setError(formatError(error));
    } finally {
      setBusy(null);
    }
  }

  async function handlePlan(): Promise<void> {
    setBusy('plan');
    setError(null);
    try {
      const response = await request({ type: 'session/cold-storage-plan' });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const nextPlan = response.data as SessionColdStoragePlan;
      setPlan(nextPlan);
      setInfo(
        isZh
          ? `已生成计划 ${nextPlan.planId}，目标 ${nextPlan.targets.length} 个。`
          : `Planned ${nextPlan.planId} with ${nextPlan.targets.length} target(s).`,
      );
    } catch (error) {
      setError(formatError(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleExecute(): Promise<void> {
    if (!plan || !canExecute) return;
    setBusy('execute');
    setError(null);
    try {
      const response = await request({
        type: 'session/cold-storage-execute',
        planId: plan.planId,
        confirmationDigest: plan.confirmationDigest,
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const result = response.data as SessionColdStorageExecuteResult;
      setPlan(null);
      setInfo(
        isZh
          ? `已转储 ${result.offloaded.length} 个会话，失败 ${result.failed.length} 个。`
          : `Offloaded ${result.offloaded.length}, failed ${result.failed.length}.`,
        result.failed.length > 0 ? 'warning' : 'success',
      );
      await refreshStatus();
    } catch (error) {
      setError(formatError(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleReconcile(): Promise<void> {
    setBusy('reconcile');
    setError(null);
    try {
      const response = await request({ type: 'session/cold-storage-reconcile' });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const result = response.data as SessionColdStorageReconcileResult;
      setInfo(
        isZh
          ? `数据校验完成：已恢复 ${result.recovered.length} 个会话，生成 ${result.reports.length} 份报告。`
          : `Reconciled: recovered ${result.recovered.length}, reports ${result.reports.length}.`,
      );
      await refreshStatus();
    } catch (error) {
      setError(formatError(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleListPacks(): Promise<void> {
    const directory = saved?.packOutputDir?.trim();
    if (!directory) {
      setInfo(
        isZh ? '请先保存 Host 输出目录。' : 'Save a Host output directory first.',
        'warning',
      );
      return;
    }
    setBusy('list');
    setError(null);
    try {
      const response = await request({ type: 'session/pack-list', directory });
      if (!response.success) {
        setError(response.error);
        return;
      }
      setPacks(response.data as SessionPackListData);
    } catch (error) {
      setError(formatError(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleImport(): Promise<void> {
    const selected = await chooseSessionPackPath(isZh ? '选择会话包' : 'Choose session pack');
    if (selected === null || selected === undefined) return;
    setBusy('import');
    setError(null);
    try {
      const response = await request({ type: 'session/cold-storage-import', packPath: selected });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const result = response.data as SessionColdStorageRestoreResult;
      setInfo(
        isZh
          ? `已从包导入会话 ${result.sessionId}。`
          : `Imported session ${result.sessionId} from pack.`,
        'success',
      );
      await refreshStatus();
    } catch (error) {
      setError(formatError(error));
    } finally {
      setBusy(null);
    }
  }

  async function pickOutputDir(): Promise<void> {
    const selected = await chooseHostDirectory(
      isZh ? '选择 Host 输出目录' : 'Choose Host output directory',
    );
    if (typeof selected === 'string' && selected.trim().length > 0) {
      setDraft((current) => ({ ...current, packOutputDir: selected.trim() }));
    }
  }

  return (
    <div className="settings-card">
      <div className="settings-section settings-section-card" data-testid="cold-storage-config">
        <PageTitle
          title={isZh ? '会话冷存储' : 'Session cold storage'}
          description={
            isZh
              ? '手动备份并转储已归档的主会话。输出目录为 Host 绝对路径。执行前必须先保存配置并确认计划摘要。'
              : 'Manually back up and offload archived main sessions. The output directory is a Host filesystem path. Save config and confirm a plan digest before execute.'
          }
        />
        <FieldRow
          label={isZh ? '启用冷存储' : 'Enable cold storage'}
          description={
            isZh
              ? '关闭后不会生成或执行转储计划。不会进行自动后台调度。'
              : 'When off, Host will not plan or execute offload. There is no schedule.'
          }
          testId="cold-storage-enabled-row"
        >
          <Switch
            checked={draft.enabled}
            onCheckedChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
            aria-label={isZh ? '启用冷存储' : 'Enable cold storage'}
            testId="cold-storage-enabled-switch"
          />
        </FieldRow>
        <FieldRow
          label={isZh ? 'Host 输出目录' : 'Host output directory'}
          description={
            isZh
              ? '必须是 Host 绝对路径，且不能位于 ~/.piwin 下。'
              : 'Must be a Host-absolute path outside the piwin root.'
          }
          testId="cold-storage-output-row"
        >
          <div className="ui-field-row-control" style={{ gap: 8 }}>
            <TextInput
              value={draft.packOutputDir}
              onChange={(event) =>
                setDraft((current) => ({ ...current, packOutputDir: event.currentTarget.value }))
              }
              placeholder="/Volumes/Drive/piwin-packs"
              testId="cold-storage-output-input"
            />
            <Button variant="ghost" data-testid="cold-storage-output-browse" onClick={() => void pickOutputDir()}>
              {isZh ? '浏览…' : 'Browse…'}
            </Button>
          </div>
        </FieldRow>
        <FieldRow
          label={isZh ? '最小归档天数' : 'Minimum archived age (days)'}
          description={
            isZh
              ? '自动候选只选择归档超过该天数的主会话。手动指定会话可跳过此门槛。'
              : 'The planner only selects main sessions archived longer than this. Explicit session plans skip the age gate.'
          }
          testId="cold-storage-age-row"
        >
          <TextInput
            value={draft.minArchivedAgeDays}
            onChange={(event) =>
              setDraft((current) => ({ ...current, minArchivedAgeDays: event.currentTarget.value }))
            }
            testId="cold-storage-age-input"
          />
        </FieldRow>
        <FieldRow
          label={isZh ? '本地预算（字节，可选）' : 'Local budget (bytes, optional)'}
          description={
            isZh
              ? '仅用于容量参考展示，不会自动触发转储。'
              : 'Status only. This never auto-executes offload.'
          }
          testId="cold-storage-budget-row"
        >
          <TextInput
            value={draft.localBudgetBytes}
            onChange={(event) =>
              setDraft((current) => ({ ...current, localBudgetBytes: event.currentTarget.value }))
            }
            testId="cold-storage-budget-input"
          />
        </FieldRow>
        {dirty ? (
          <div className="ui-field-row-control" style={{ justifyContent: 'flex-end' }}>
            <Button data-testid="cold-storage-save-button" disabled={saving} onClick={() => void handleSave()}>
              {isZh ? '保存' : 'Save'}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="settings-section settings-section-card" data-testid="cold-storage-ops">
        <PageTitle
          title={isZh ? '计划与执行' : 'Plan and execute'}
          description={
            isZh
              ? '计划只存在于当前 Host 进程。重启后必须重新生成。执行会再次校验摘要。'
              : 'Plans live only in this Host process. Restart invalidates them. Execute re-checks the digest.'
          }
        />
        <div className="ui-field-row-control" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button variant="ghost" data-testid="cold-storage-status-button" disabled={busy !== null} onClick={() => void refreshStatus()}>
            {isZh ? '刷新状态' : 'Refresh status'}
          </Button>
          <Button variant="ghost" data-testid="cold-storage-plan-button" disabled={busy !== null} onClick={() => void handlePlan()}>
            {isZh ? '生成计划' : 'Create plan'}
          </Button>
          <Button
            data-testid="cold-storage-execute-button"
            disabled={!canExecute || busy !== null}
            onClick={() => void handleExecute()}
          >
            {isZh ? '确认并执行' : 'Confirm & execute'}
          </Button>
          <Button variant="ghost" data-testid="cold-storage-reconcile-button" disabled={busy !== null} onClick={() => void handleReconcile()}>
            {isZh ? '校验同步' : 'Reconcile'}
          </Button>
        </div>
        {status ? (
          <pre className="muted" data-testid="cold-storage-status-view">
            {`enabled=${status.config.enabled} validDir=${status.packOutputDirValid} eligible=${status.eligibleCount} localBytes=${status.localPayloadBytes} missingPack=${status.missingPackSessionIds.length}`}
          </pre>
        ) : null}
        {plan ? (
          <pre className="muted" data-testid="cold-storage-plan-view">
            {`plan=${plan.planId}\nconfirm=${plan.confirmationDigest}\ntargets=${plan.targets.length} skipped=${plan.skipped.length}`}
          </pre>
        ) : null}
      </div>

      <div className="settings-section settings-section-card" data-testid="cold-storage-packs">
        <PageTitle
          title={isZh ? '外部包' : 'External packs'}
          description={
            isZh
              ? '列出已保存输出目录中的备份包，或从中恢复缺失的会话索引。Piwin 不会删除外部备份包。'
              : 'List packs in the saved output directory, or import a missing index stub from a pack. Piwin never deletes external packs.'
          }
        />
        <div className="ui-field-row-control" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button variant="ghost" data-testid="cold-storage-list-packs-button" disabled={busy !== null} onClick={() => void handleListPacks()}>
            {isZh ? '列出包' : 'List packs'}
          </Button>
          <Button variant="ghost" data-testid="cold-storage-import-button" disabled={busy !== null} onClick={() => void handleImport()}>
            {isZh ? '从包导入…' : 'Import from pack…'}
          </Button>
        </div>
        {packs ? (
          <pre className="muted" data-testid="cold-storage-pack-list">
            {packs.packs.length === 0
              ? isZh
                ? '（目录中没有包）'
                : '(no packs)'
              : packs.packs
                  .map((pack) => `${pack.valid ? 'ok' : 'bad'}\t${pack.sessionId || '-'}\t${pack.packPath}`)
                  .join('\n')}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
