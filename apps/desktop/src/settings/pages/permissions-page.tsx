/**
 * Settings → Permissions page (ADR 0019 §3 first-tier UX).
 *
 * Mode switcher bound to `config.permissions?.mode ?? 'auto'`, saved via
 * `saveConfig`. Trust-aware notices explain what each mode does and how the
 * open project's trust state interacts with bypass + project allow rules.
 * Rule files and mode both take effect on the next session (no hot-reload).
 */
import { useState, type ReactElement } from 'react';
import type { PermissionMode } from '@piwin/contracts';
import { Notice, Select } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

const MODE_ORDER: readonly PermissionMode[] = ['auto', 'ask-all', 'bypass'];

export function PermissionsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { config, projectPath, projectTrusted, saveConfig, saving } = useSettings();
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentMode: PermissionMode = config?.permissions?.mode ?? 'auto';
  const hasProject = projectPath !== null;
  const bypassRefused = currentMode === 'bypass' && hasProject && !projectTrusted;

  async function handleModeChange(next: PermissionMode): Promise<void> {
    if (!config) return;
    setSaveError(null);
    const ok = await saveConfig({
      ...config,
      permissions: { ...config.permissions, mode: next },
    });
    if (!ok) {
      setSaveError(isChinese ? '保存权限模式失败。' : 'Failed to save permission mode.');
    }
  }

  return (
    <div className="settings-card" data-testid="settings-permissions">
      <div className="settings-section settings-section-card">
        <PageTitle
          title={isChinese ? '权限控制模式' : 'Permission mode'}
          description={
            isChinese
              ? '控制代理运行工具时的询问频率。规则文件与模式均在下一次会话生效。'
              : 'Controls how often the agent asks before running tools. Rule files and mode apply on the next session.'
          }
        />

        <FieldRow
          label={isChinese ? '当前模式' : 'Active mode'}
          description={
            isChinese
              ? 'Auto — 低打扰；Ask all — 未匹配的 bash 与写入都会询问；Bypass — 除 deny 规则外全部放行。'
              : 'Auto — low friction; Ask all — unmatched bash + writes ask; Bypass — everything except deny rules.'
          }
        >
          <Select
            value={currentMode}
            testId="settings-permission-mode-select"
            aria-label={isChinese ? '权限模式' : 'Permission mode'}
            data={MODE_ORDER.map((mode) => ({
              value: mode,
              label: modeLabel(mode, isChinese),
            }))}
            onChange={(event) => {
              void handleModeChange(event.currentTarget.value as PermissionMode);
            }}
            disabled={saving || config === null}
            style={{ minWidth: 180 }}
          />
        </FieldRow>

        <div style={{ marginTop: 12, paddingTop: 16, borderTop: '1px solid color-mix(in srgb, var(--line-soft) 50%, transparent)' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>
            {isChinese ? '模式机制说明' : 'Mode mechanics'}
          </h4>
          <ul className="capability-matrix-list" data-testid="settings-permission-notes">
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <strong>{isChinese ? 'Auto（默认）' : 'Auto (default)'}</strong>
                <span className="muted">
                  {' '}
                  —{' '}
                  {isChinese
                    ? '低打扰；danger/ask 模式仍然适用；deny 始终生效。'
                    : 'low friction; danger/ask patterns still apply; deny always enforced.'}
                </span>
              </span>
            </li>
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <strong>{isChinese ? 'Ask all' : 'Ask all'}</strong>
                <span className="muted">
                  {' '}
                  —{' '}
                  {isChinese ? '未匹配的 bash 与文件写入都会询问。' : 'unmatched bash + writes ask.'}
                </span>
              </span>
            </li>
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <strong>{isChinese ? 'Bypass' : 'Bypass'}</strong>
                <span className="muted">
                  {' '}
                  —{' '}
                  {isChinese
                    ? '除 deny 规则外全部放行；未信任项目拒绝使用。'
                    : 'everything except deny rules; refused for untrusted projects.'}
                </span>
              </span>
            </li>
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <span className="muted">
                  {isChinese
                    ? 'Ask 层规则优先于 allow 层规则（例如 ~/.config/** 的 bundled ask 不能被更具体的 allow 覆盖）。'
                    : 'Ask-tier rules beat allow-tier rules (e.g. the bundled ~/.config/** ask cannot be allowed away by a more specific allow).'}
                </span>
              </span>
            </li>
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <span className="muted">
                  {isChinese
                    ? 'MCP：启用的服务器拥有完整工具访问权，无需逐次确认。'
                    : 'MCP: an enabled server has full tool access without per-call prompts.'}
                </span>
              </span>
            </li>
          </ul>
        </div>
      </div>

      {hasProject ? (
        <div className="settings-section settings-section-card" data-testid="settings-permission-trust">
          <PageTitle
            title={isChinese ? '项目信任与策略' : 'Project trust & policy'}
            description={isChinese ? '当前工作区的信任级别与有效权限覆盖。' : 'Active workspace trust tier and rule overrides.'}
          />
          {projectTrusted ? (
            <Notice tone="success" testId="settings-permission-trust-trusted">
              {isChinese
                ? '当前项目已信任：项目 allow 规则生效，可使用 bypass 模式。'
                : 'This project is trusted: project allow rules apply and bypass mode is available.'}
            </Notice>
          ) : (
            <Notice tone="warning" testId="settings-permission-trust-untrusted">
              {isChinese
                ? '当前项目未信任：项目 allow 规则被忽略；bypass 模式将被拒绝（降级为 auto）。'
                : 'This project is untrusted: project allow rules are ignored and bypass mode is refused (downgraded to auto).'}
            </Notice>
          )}
        </div>
      ) : (
        <div className="settings-section settings-section-card" data-testid="settings-permission-trust">
          <PageTitle
            title={isChinese ? '通用范围' : 'General scope'}
            description={isChinese ? '没有打开特定项目时的全局权限规则。' : 'Global permission rules when no project is open.'}
          />
          <Notice tone="info" testId="settings-permission-general-scope">
            {isChinese
              ? '未打开项目。通用范围可使用 bypass 模式（你的机器，你做主）。'
              : 'No project open. General scope may use bypass mode (your machine, your choice).'}
          </Notice>
        </div>
      )}

      {bypassRefused ? (
        <div className="settings-section">
          <Notice tone="warning" testId="settings-permission-bypass-refused">
            {isChinese
              ? 'Bypass 模式对未信任项目被拒绝。请先信任项目，或切换到 Auto / Ask all。'
              : 'Bypass mode is refused for untrusted projects. Trust the project first, or switch to Auto / Ask all.'}
          </Notice>
        </div>
      ) : null}

      {saveError ? (
        <div className="settings-section">
          <Notice tone="error" testId="settings-permission-save-error">
            {saveError}
          </Notice>
        </div>
      ) : null}
    </div>
  );
}

function modeLabel(mode: PermissionMode, isChinese: boolean): string {
  switch (mode) {
    case 'auto':
      return isChinese ? 'Auto（自动）' : 'Auto';
    case 'ask-all':
      return isChinese ? 'Ask all（全部询问）' : 'Ask all';
    case 'bypass':
      return isChinese ? 'Bypass（绕过）' : 'Bypass';
  }
}
