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
import { RememberedPermissionsSection } from '../../RememberedPermissionsSection';
import { permissionModeSavedEffectMessage } from '../../settings-effect-copy.js';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';
import { PermissionRulesEditor } from './permission-rules-editor';

const PRESET_ORDER: readonly PermissionPreset[] = ['auto', 'ask', 'yolo'];

type ModeMeta = {
  title: string;
  badge: string;
  badgeTone: 'pine' | 'lamp' | 'zhu';
  tagline: string;
  description: string;
  features: readonly string[];
};

function getModeMeta(preset: PermissionPreset, isChinese: boolean): ModeMeta {
  switch (preset) {
    case 'auto':
      return {
        title: 'Auto',
        badge: isChinese ? '推荐' : 'Recommended',
        badgeTone: 'pine',
        tagline: isChinese ? '智能托管 · 平衡效率与安全' : 'Smart Autonomy · Balanced',
        description: isChinese
          ? '沙箱内自动执行常用工具与文件读写；涉及网络请求、关键系统命令或工作区外修改时主动提示确认。'
          : 'Auto-runs workspace operations; prompts before network calls, critical shell commands, or writing outside the workspace.',
        features: isChinese
          ? ['沙箱自主执行', '敏感操作确认', '日常开发首选']
          : ['Workspace auto', 'Prompt sensitive', 'Daily driver'],
      };
    case 'ask':
      return {
        title: 'Ask',
        badge: isChinese ? '严格' : 'Strict',
        badgeTone: 'lamp',
        tagline: isChinese ? '逐步确认 · 严格人工把控' : 'Step-by-step · Full Oversight',
        description: isChinese
          ? '几乎每个工具调用与命令执行均需手动批准，智能体在你的严密监督下谨慎推进。适合代码审计与敏感仓库。'
          : 'Confirms almost every tool invocation and command. Maximum oversight and safety for sensitive codebases.',
        features: isChinese
          ? ['逐次手动批准', '最高透明度', '杜绝非预期变更']
          : ['Per-call approval', 'Max visibility', 'Zero surprise'],
      };
    case 'yolo':
      return {
        title: 'YOLO',
        badge: isChinese ? '极速' : 'Full Speed',
        badgeTone: 'zhu',
        tagline: isChinese ? '全速推进 · 跳过常规确认' : 'Full Throttle · Zero Friction',
        description: isChinese
          ? '跳过常规确认提示，全速流式执行；底层全局 deny 拒绝规则与高危破坏性操作熔断始终强制生效。'
          : 'Skips routine confirmations for high-speed continuous flow; global deny rules and safety circuit breakers always apply.',
        features: isChinese
          ? ['免确认全速执行', '极致流式体验', '硬性熔断兜底']
          : ['Zero prompts', 'Continuous stream', 'Hard breakers active'],
      };
  }
}

export function PermissionsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { config, projectPath, projectTrusted, saveConfig, saving, request } = useSettings();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveInfo, setSaveInfo] = useState<string | null>(null);

  const currentPreset: PermissionPreset = resolvePermissionPreset(config?.permissions);
  const canEditPreset = !saving && config !== null;
  const hasProject = projectPath !== null;
  const yoloRefused = currentPreset === 'yolo' && hasProject && !projectTrusted;

  async function handlePresetChange(next: PermissionPreset): Promise<void> {
    if (!config) return;
    setSaveError(null);
    setSaveInfo(null);
    const resolved = resolvePreset(next);
    const ok = await saveConfig({
      ...config,
      permissions: { mode: resolved.mode, preset: next },
    });
    if (!ok) {
      setSaveError(isChinese ? '保存运行模式失败。' : 'Failed to save Run Mode.');
      return;
    }
    setSaveInfo(permissionModeSavedEffectMessage(locale));
  }

  return (
    <div className="settings-card" data-testid="settings-permissions">
      <div className="settings-section settings-section-card">
        <PageTitle
          title={isChinese ? '运行模式' : 'Run mode'}
          description={
            isChinese
              ? '设定智能体执行工具与命令时的自主程度。规则与模式在下一次会话生效。'
              : 'Configure autonomy tier for agent actions. Rules and mode apply on the next session.'
          }
        />

        <div
          className="permission-mode-deck"
          data-testid="settings-permission-mode-group"
          role="radiogroup"
          aria-label={isChinese ? '运行模式选择' : 'Run mode selection'}
        >
          {/* Keep Select for test-harness compatibility */}
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

          <div className="permission-mode-cards">
            {PRESET_ORDER.map((preset) => {
              const isActive = currentPreset === preset;
              const isYoloRestrictedHere = preset === 'yolo' && hasProject && !projectTrusted;
              const meta = getModeMeta(preset, isChinese);

              return (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  data-testid={`settings-permission-mode-${preset}`}
                  className={`permission-mode-card mode-${preset} ${isActive ? 'is-active' : ''} ${isYoloRestrictedHere ? 'is-restricted' : ''}`}
                  onClick={() => void handlePresetChange(preset)}
                  disabled={!canEditPreset}
                >
                  <div className="mode-card-header">
                    <div className="mode-card-title-wrap">
                      <span className="mode-pill-dot mode-card-dot" aria-hidden />
                      <span className="mode-pill-label mode-card-title">{meta.title}</span>
                      <span className={`mode-card-badge badge-${meta.badgeTone}`}>{meta.badge}</span>
                    </div>
                    <span className="mode-card-selector" aria-hidden>
                      {isActive ? (
                        <svg className="mode-card-check-icon" viewBox="0 0 16 16" fill="none">
                          <circle
                            cx="8"
                            cy="8"
                            r="7.25"
                            fill="currentColor"
                            fillOpacity="0.14"
                            stroke="currentColor"
                            strokeWidth="1.5"
                          />
                          <path
                            d="M4.75 8.25L6.75 10.25L11.25 5.75"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      ) : (
                        <span className="mode-card-radio-ring" />
                      )}
                    </span>
                  </div>

                  <div className="mode-card-tagline">{meta.tagline}</div>
                  <div className="mode-card-desc">{meta.description}</div>

                  <div className="mode-card-features">
                    {meta.features.map((feature) => (
                      <span key={feature} className="mode-card-feature-pill">
                        {feature}
                      </span>
                    ))}
                  </div>

                  {isYoloRestrictedHere ? (
                    <div className="mode-card-restricted-hint">
                      <span className="mode-card-restricted-dot" />
                      {isChinese ? '未信任项目不可用（将降级为 Auto）' : 'Untrusted project (downgrades to Auto)'}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <details className="settings-disclosure permission-mode-mechanics">
          <summary className="permission-mechanics-summary">
            <span className="permission-mechanics-summary-text">
              {isChinese ? '模式机制与安全规则说明' : 'How modes and safety rules work'}
            </span>
          </summary>
          <ul className="capability-matrix-list" data-testid="settings-permission-notes">
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <strong>{isChinese ? '规则优先级' : 'Rule priority'}</strong>
                <span className="muted">
                  {' '}
                  —{' '}
                  {isChinese
                    ? 'Ask 层规则优先于 allow 层规则（例如系统预置的 ~/.config/** 保护不可被工作区规则覆盖）。'
                    : 'Ask-tier rules beat allow-tier rules (e.g. bundled ~/.config/** ask cannot be allowed away by a more specific allow).'}
                </span>
              </span>
            </li>
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <strong>{isChinese ? '审批记忆范围' : 'Approval scopes'}</strong>
                <span className="muted">
                  {' '}
                  —{' '}
                  {isChinese
                    ? '支持单次允许、会话有效（仅在内存中，会话关闭后自动失效）以及项目级持久化保存。'
                    : 'Approval scopes: once / session / project. Session scope is in-memory and cleared on close.'}
                </span>
              </span>
            </li>
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <strong>{isChinese ? 'MCP 工具信任' : 'MCP tools'}</strong>
                <span className="muted">
                  {' '}
                  —{' '}
                  {isChinese
                    ? '启用的 MCP 服务器拥有对应工具的完整访问权，无需逐次弹出确认。'
                    : 'An enabled MCP server has full tool access without per-call prompts.'}
                </span>
              </span>
            </li>
            <li className="capability-row available">
              <span className="capability-mark" aria-hidden>
                ●
              </span>
              <span className="capability-body">
                <strong>{isChinese ? '底层安全熔断' : 'Safety circuit breakers'}</strong>
                <span className="muted">
                  {' '}
                  —{' '}
                  {isChinese
                    ? '全局 deny 拒绝规则、高危破坏性命令拦截及路径越界防护在所有模式下强制生效。'
                    : 'Global deny rules, dangerous command blocks, and path traversal protection remain active in all modes.'}
                </span>
              </span>
            </li>
          </ul>
        </details>
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
      ) : null}

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

      {saveInfo ? (
        <div className="settings-section">
          <Notice tone="info" testId="settings-permission-save-info">
            {saveInfo}
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
