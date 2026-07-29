/**
 * Settings → General page (Wave 1 migration from SettingsPanel).
 * Language select, host capability matrix, agent runtime mode, and the
 * remembered-permissions list. Reads state via useSettings().
 */
import type { ReactElement } from 'react';
import { useState } from 'react';
import { buildCapabilityMatrix } from '@piwin/contracts';
import { getDesktopCopy, type DesktopLocale } from '../../desktop-locale';
import { useDesktopLocale } from '../../desktop-locale-context';
import { Collapse, Select, Switch } from '@piwin/ui-kit';
import { RememberedPermissionsSection } from '../../RememberedPermissionsSection';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

/** Desktop Settings is zh-CN; capability matrix English labels stay for CLI. */
const CAPABILITY_LABEL_ZH: Record<string, string> = {
  customTools: '自定义工具（Web / MCP / 记忆 / 进程）',
  productTranscript: '产品层会话恢复',
  mcpLifecycle: 'MCP 生命周期',
  sessionLifecycle: '会话重命名 / 归档 / 复制',
  sessionSearch: '会话搜索',
  memory: '记忆工具',
  process: '托管进程',
  pty: '交互终端（PTY）',
  shellPreview: 'Shell 预览（管道）',
  automation: '自动化（定时 / Hooks）',
  extensions: 'Pi 扩展',
  rpcIsolation: 'RPC 进程隔离',
};

const CAPABILITY_LABEL_EN: Record<string, string> = {
  customTools: 'Custom tools (Web / MCP / Memory / Process)',
  productTranscript: 'Product transcript restoration',
  mcpLifecycle: 'MCP lifecycle',
  sessionLifecycle: 'Session rename / archive / duplicate',
  sessionSearch: 'Session search',
  memory: 'Memory tools',
  process: 'Managed processes',
  pty: 'Interactive terminal (PTY)',
  shellPreview: 'Shell preview (piped)',
  automation: 'Automation (cron / hooks)',
  extensions: 'Pi extensions',
  rpcIsolation: 'RPC process isolation',
};

const CAPABILITY_NOTE_ZH: Record<string, string> = {
  'Host path is shell preview; interactive PTY is Tauri desktop (ADR 0013)':
    'Host 路径为 Shell 预览；交互 PTY 由 Tauri 桌面提供（ADR 0013）',
  'Hooks are post-event only; optional': 'Hooks 仅 post-event；可选',
  'Host mode is SDK (in-process)': '运行模式为 SDK（进程内）',
  'RPC host uses SDK session backend': 'RPC 模式使用 SDK 会话后端',
  'Use SDK host mode (or live RPC with SDK fallback)': '使用 SDK 模式（或带 SDK 回退的 RPC）',
  'Not available': '不可用',
  'Superseded by real PTY': '已被真实 PTY 取代',
  'RPC mode: SDK backend (no process isolation)': 'RPC 模式：SDK 后端（无进程隔离）',
  'Mock RPC — isolation not simulated': 'Mock RPC — 未模拟隔离',
};

function localizeCapabilityNote(
  note: string | undefined,
  locale: DesktopLocale,
): string | undefined {
  if (!note) return undefined;
  if (locale === 'en') return note;
  return CAPABILITY_NOTE_ZH[note] ?? note;
}

function getCapabilityLabel(capabilityId: string, fallback: string, locale: DesktopLocale): string {
  if (locale === 'en') return CAPABILITY_LABEL_EN[capabilityId] ?? fallback;
  return CAPABILITY_LABEL_ZH[capabilityId] ?? fallback;
}

export function GeneralPage(): ReactElement {
  const { locale, setLocale } = useDesktopLocale();
  const copy = getDesktopCopy(locale);
  const {
    config,
    hostStatus,
    projectPath,
    request,
    saveConfig,
  } = useSettings();
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);

  async function handleToggleMock(agentMock: boolean): Promise<void> {
    if (!config) return;
    await saveConfig({ ...config, agentMock });
  }

  return (
    <div className="settings-card">
      <div className="settings-section">
        <PageTitle
          title={copy.language}
          description={copy.languageDescription}
        />
        <FieldRow label={copy.language}>
          <Select
            value={locale}
            testId="settings-language-select"
            aria-label={copy.language}
            data={[
              { value: 'zh-CN', label: copy.chinese },
              { value: 'en', label: copy.english },
            ]}
            onChange={(event) => setLocale(event.currentTarget.value as DesktopLocale)}
            style={{ minWidth: 140 }}
          />
        </FieldRow>
      </div>

      <div className="settings-section">
        <PageTitle
          title={locale === 'zh-CN' ? 'Agent 运行模式' : 'Agent runtime'}
          description={locale === 'zh-CN' ? '控制新会话是否连接到 Host 与模型。' : 'Choose whether new sessions connect to the host and configured models.'}
        />
        {config ? (
          <FieldRow
            label={locale === 'zh-CN' ? '在线模式' : 'Online mode'}
            description={locale === 'zh-CN' ? '开启后连接到 Host 与模型；关闭则保持离线（Mock）。' : 'Connect to host/model when enabled; stay offline (Mock) when disabled.'}
          >
            <Switch
              checked={config.agentMock !== true}
              onCheckedChange={(online) => void handleToggleMock(!online)}
              aria-label={locale === 'zh-CN' ? '在线模式' : 'Online mode'}
            />
          </FieldRow>
        ) : null}
      </div>

      <RememberedPermissionsSection
        projectPath={projectPath}
        expanded={permissionsOpen}
        onToggle={() => setPermissionsOpen((v) => !v)}
        request={async (command) =>
          request({
            type: command.type,
            path: command.path,
            ...(command.key ? { key: command.key } : {}),
          })
        }
      />

      {hostStatus ? (
        <div className="settings-section" data-testid="capability-matrix">
          <button
            type="button"
            className="settings-collapsible-trigger"
            onClick={() => setCapabilitiesOpen((v) => !v)}
            aria-expanded={capabilitiesOpen}
            data-testid="capability-matrix-toggle"
          >
            <PageTitle
              title={locale === 'zh-CN' ? 'Host 能力 (高级)' : 'Host capabilities (Advanced)'}
              description={
                <>
                  {locale === 'zh-CN' ? '当前模式' : 'Current mode'}{' '}
                  <code>{hostStatus.mode}</code>
                  {hostStatus.mock ? ' · mock' : ''}
                </>
              }
            />
            <svg
              className={`settings-collapsible-chevron ${capabilitiesOpen ? 'open' : ''}`}
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <Collapse expanded={capabilitiesOpen} testId="capability-matrix-collapse">
            <ul className="capability-matrix-list">
              {buildCapabilityMatrix(hostStatus.capabilities, {
                mode: hostStatus.mode,
                mock: hostStatus.mock,
              }).map((row) => (
                <li
                  key={row.id}
                  className={
                    row.available
                      ? 'capability-row available'
                      : 'capability-row unavailable'
                  }
                  data-testid={`capability-row-${row.id}`}
                >
                  <span className="capability-mark" aria-hidden>
                    {row.available ? '●' : '○'}
                  </span>
                  <span className="capability-body">
                    <strong>{getCapabilityLabel(row.id, row.label, locale)}</strong>
                    {localizeCapabilityNote(row.note, locale) ? (
                      <span className="muted"> — {localizeCapabilityNote(row.note, locale)}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Collapse>
        </div>
      ) : null}
    </div>
  );
}
