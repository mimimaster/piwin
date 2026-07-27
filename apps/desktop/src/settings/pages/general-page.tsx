/**
 * Settings → General page (Wave 1 migration from SettingsPanel).
 * Language select, host capability matrix, agent runtime mode, and the
 * remembered-permissions list. Reads state via useSettings().
 */
import type { ReactElement } from 'react';
import { buildCapabilityMatrix } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { getDesktopCopy, type DesktopLocale } from '../../desktop-locale';
import { useDesktopLocale } from '../../desktop-locale-context';
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
  'Host mode is SDK (in-process)': '桌面 Host 模式为 SDK（进程内）',
  'RPC host uses SDK session backend': 'RPC Host 使用 SDK 会话后端',
  'Use SDK host mode (or live RPC with SDK fallback)': '请使用 SDK Host 模式（或带 SDK 回退的 RPC）',
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
    selectSection,
  } = useSettings();

  async function handleToggleMock(agentMock: boolean): Promise<void> {
    if (!config) return;
    await saveConfig({ ...config, agentMock });
  }

  return (
    <div className="settings-card settings-overview-card">
      <div className="settings-section settings-language-section">
        <FieldRow label={copy.language} description={copy.languageDescription}>
          <select
            value={locale}
            data-testid="settings-language-select"
            aria-label={copy.language}
            onChange={(event) => setLocale(event.target.value as DesktopLocale)}
          >
            <option value="zh-CN">{copy.chinese}</option>
            <option value="en">{copy.english}</option>
          </select>
        </FieldRow>
      </div>
      {hostStatus ? (
        <div className="settings-section" data-testid="capability-matrix">
          <PageTitle
            title={locale === 'zh-CN' ? 'Host 能力' : 'Host capabilities'}
            description={
              <>
                {locale === 'zh-CN' ? '当前模式' : 'Current mode'}{' '}
                <code>{hostStatus.mode}</code>
                {hostStatus.mock ? ' · mock' : ''}
                {locale === 'zh-CN'
                  ? '。灰色项表示不可用或部分可用。'
                  : '. Dimmed entries are unavailable or partially available.'}
              </>
            }
          />
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
        </div>
      ) : null}
      <div className="settings-section">
        <PageTitle
          title={locale === 'zh-CN' ? 'Agent 运行模式' : 'Agent runtime'}
          description={locale === 'zh-CN' ? '控制新会话是否连接到 Host 与模型。' : 'Choose whether new sessions connect to the host and configured models.'}
          trailing={<span className="settings-count">{config?.providers.length ?? 0}</span>}
        />
        {config ? (
          <FieldRow
            label={locale === 'zh-CN' ? 'Agent 模式' : 'Agent mode'}
            description={locale === 'zh-CN' ? 'Mock 会话保持离线，不会调用真实模型 API。' : 'Mock sessions stay offline and do not call a real model API.'}
          >
            <select
              value={config.agentMock === true ? 'mock' : 'live'}
              onChange={(event) => void handleToggleMock(event.target.value === 'mock')}
              data-testid="settings-agent-mode"
            >
              <option value="live">{locale === 'zh-CN' ? '在线（Host + 模型）' : 'Live (host + model)'}</option>
              <option value="mock">{locale === 'zh-CN' ? 'Mock（离线）' : 'Mock (offline)'}</option>
            </select>
          </FieldRow>
        ) : null}
        <Button onClick={() => selectSection('models')}>
          {locale === 'zh-CN' ? '打开模型设置…' : 'Open Models settings…'}
        </Button>
      </div>

      <RememberedPermissionsSection
        projectPath={projectPath}
        request={async (command) =>
          request({
            type: command.type,
            path: command.path,
            ...(command.key ? { key: command.key } : {}),
          })
        }
      />
    </div>
  );
}
