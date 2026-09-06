/**
 * Settings → Permissions page (ADR 0019 §3, ADR 0024 Run Modes).
 *
 * Preset switcher bound to {@link resolvePermissionPreset}, saved via
 * `saveConfig`. Trust-aware notices explain what each Run Mode does and how the
 * open project's trust state interacts with YOLO + project allow rules.
 * Rule files and preset both take effect on the next session (no hot-reload).
 */
import { useState, type ReactElement } from 'react';
import type { PermissionPreset } from '@piwin/contracts';
import { resolvePermissionPreset, resolvePreset } from '@piwin/contracts';
import { Notice, Select } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';
import { RememberedPermissionsSection } from '../../RememberedPermissionsSection';
import { PermissionRulesEditor } from './permission-rules-editor';

const PRESET_ORDER: readonly PermissionPreset[] = ['auto', 'ask', 'yolo'];

export function PermissionsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { config, projectPath, projectTrusted, saveConfig, saving, request } = useSettings();
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentPreset: PermissionPreset = resolvePermissionPreset(config?.permissions);
  const canEditPreset = !saving && config !== null;
  const hasProject = projectPath !== null;
  const yoloRefused = currentPreset === 'yolo' && hasProject && !projectTrusted;

  async function handlePresetChange(next: PermissionPreset): Promise<void> {
    if (!config) return;
    setSaveError(null);
    const resolved = resolvePreset(next);
    const ok = await saveConfig({
      ...config,
      permissions: { mode: resolved.mode, preset: next },
    });
    if (!ok) {
      setSaveError(isChinese ? '保存运行模式失败。' : 'Failed to save Run Mode.');
    }
  }

  return (
    <div className="settings-card" data-testid="settings-permissions">
      <div className="settings-section settings-section-card">
        <PageTitle
          title={isChinese ? '运行模式' : 'Run mode'}
          description={
            isChinese
              ? '控制代理运行工具时的询问频率与沙箱。规则文件与模式均在下一次会话生效。'
              : 'Controls how often the agent asks before running tools, and the sandbox boundary. Rule files and mode apply on the next session.'
          }
        />

        <FieldRow
          label={isChinese ? '当前模式' : 'Active mode'}
          description={
            isChinese
              ? 'Auto — 沙箱内低打扰；Ask — 几乎每次都确认；YOLO — 关闭沙箱，跳过常规确认。'
              : 'Auto — low friction inside sandbox; Ask — confirm almost everything; YOLO — no sandbox, skip routine prompts.'
          }
        >
          <div className="permission-mode-selector" data-testid="settings-permission-mode-group">
            <Select
              value={currentPreset}
              testId="settings-permission-mode-select"
              aria-label={isChinese ? '运行模式' : 'Run mode'}
              data={PRESET_ORDER.map((preset) => ({
                value: preset,
                label: presetLabel(preset, isChinese),
              }))}
              onChange={(event) => {
                void handlePresetChange(event.currentTarget.value as PermissionPreset);
              }}
              disabled={!canEditPreset}
              style={{ display: 'none' }}
            />
            <div className="permission-mode-pills">
              {PRESET_ORDER.map((preset) => {
                const isActive = currentPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    className={`permission-mode-pill perm-pill ${isActive ? 'is-active sel' : ''} mode-${preset}`}
                    onClick={() => void handlePresetChange(preset)}
                    disabled={!canEditPreset}
                  >
                    <span className="mode-pill-dot" />
                    <span className="mode-pill-label">{presetLabel(preset, isChinese)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </FieldRow>

        <div
          style={{
            marginTop: 12,
            paddingTop: 16,
            borderTop: '1px solid color-mix(in srgb, var(--line-soft) 50%, transparent)',
          }}
        >
          <h4
            style={{ margin: '0 0 12px 0', fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}
          >
            {isChinese ? '模式机制说明' : 'Mode mechanics'}
          </h4>
          <ul className="capability-matrix-list" data-testid="settings-permission-notes">
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <strong>{isChinese ? 'YOLO（默认）' : 'YOLO (default)'}</strong>
                <span className="muted">
                  {' '}
                  —{' '}
                  {isChinese
                    ? '新会话默认使用 YOLO；跳过常规确认，但 deny 和危险操作保护始终生效。'
                    : 'New sessions default to YOLO; routine prompts are skipped, but deny rules and circuit breakers always apply.'}
                </span>
              </span>
            </li>
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <strong>{isChinese ? 'Ask' : 'Ask'}</strong>
                <span className="muted">
                  {' '}
                  —{' '}
                  {isChinese
                    ? '几乎每个工具都确认（仍在沙箱内）。'
                    : 'confirm almost every tool call (still sandboxed).'}
                </span>
              </span>
            </li>
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <strong>{isChinese ? 'Auto' : 'Auto'}</strong>
                <span className="muted">
                  {' '}
                  —{' '}
                  {isChinese
                    ? '沙箱内低打扰；离开工作区或出网时询问，适合更谨慎的日常开发。'
                    : 'low friction inside the sandbox; asks before leaving the workspace or opening network, for safer daily coding.'}
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
                    ? '审批记忆范围：本次 / 本会话 / 本项目。会话范围仅在内存中，关闭后失效。'
                    : 'Approval scopes: once / session / project. Session scope is in-memory and cleared on close.'}
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
        <div
          className="settings-section settings-section-card"
          data-testid="settings-permission-trust"
        >
          <PageTitle
            title={isChinese ? '项目信任与策略' : 'Project trust & policy'}
            description={
              isChinese
                ? '当前工作区的信任级别与有效权限覆盖。'
                : 'Active workspace trust tier and rule overrides.'
            }
          />
          {projectTrusted ? (
            <Notice tone="success" testId="settings-permission-trust-trusted">
              {isChinese
                ? '当前项目已信任：项目 allow 规则生效，可使用 YOLO 模式。'
                : 'This project is trusted: project allow rules apply and YOLO mode is available.'}
            </Notice>
          ) : (
            <Notice tone="warning" testId="settings-permission-trust-untrusted">
              {isChinese
                ? '当前项目未信任：项目 allow 规则被忽略；YOLO 模式将被拒绝（降级为 Auto）。'
                : 'This project is untrusted: project allow rules are ignored and YOLO mode is refused (downgraded to Auto).'}
            </Notice>
          )}
        </div>
      ) : (
        <div
          className="settings-section settings-section-card"
          data-testid="settings-permission-trust"
        >
          <PageTitle
            title={isChinese ? '通用范围' : 'General scope'}
            description={
              isChinese
                ? '没有打开特定项目时的全局权限规则。'
                : 'Global permission rules when no project is open.'
            }
          />
          <Notice tone="info" testId="settings-permission-general-scope">
            {isChinese
              ? '未打开项目。通用范围可使用 YOLO 模式（你的机器，你做主）。'
              : 'No project open. General scope may use YOLO mode (your machine, your choice).'}
          </Notice>
        </div>
      )}

      {yoloRefused ? (
        <div className="settings-section">
          <Notice tone="warning" testId="settings-permission-bypass-refused">
            {isChinese
              ? 'YOLO 模式对未信任项目被拒绝。请先信任项目，或切换到 Auto / Ask。'
              : 'YOLO mode is refused for untrusted projects. Trust the project first, or switch to Auto / Ask.'}
          </Notice>
        </div>
      ) : null}

      <RememberedPermissionsSection
        projectPath={projectPath}
        request={(command) => request(command)}
      />

      <PermissionRulesEditor />

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

function presetLabel(preset: PermissionPreset, _isChinese: boolean): string {
  switch (preset) {
    case 'auto':
      return 'Auto';
    case 'ask':
      return 'Ask';
    case 'yolo':
      return 'YOLO';
  }
}
