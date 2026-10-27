/**
 * Settings → Connection: the active Host's capability matrix, folded by
 * default because it is a diagnostic, not a preference.
 */
import { useState, type ReactElement } from 'react';
import { buildCapabilityMatrix } from '@piwin/contracts';
import { Collapse } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { PageTitle } from './page-title';
import { useSettings } from './settings-context';

const CAPABILITY_LABEL_ZH: Record<string, string> = {
  customTools: '自定义工具（Web / MCP / 记忆 / 进程）',
  productTranscript: '产品层会话恢复',
  mcpLifecycle: 'MCP 生命周期',
  sessionLifecycle: '会话重命名 / 归档 / 复制',
  sessionSearch: '会话搜索',
  memory: '记忆工具',
  process: '托管进程',
  pty: '交互终端（PTY）',
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
  automation: 'Automation (cron / hooks)',
  extensions: 'Pi extensions',
  rpcIsolation: 'RPC process isolation',
};

const CAPABILITY_NOTE_ZH: Record<string, string> = {
  'Host path is shell preview; interactive PTY is Tauri desktop (ADR 0013)':
    'Host 路径为 Shell 预览；交互式终端由桌面端提供',
  'Hooks are post-event only; optional': '事件钩子仅在事件结束后触发；可选',
  'Host mode is SDK (in-process)': '运行模式为 SDK（进程内）',
  'RPC host uses SDK session backend': 'RPC 模式使用 SDK 会话后端',
  'Use SDK host mode (or live RPC with SDK fallback)': '使用 SDK 模式（或带 SDK 回退的 RPC）',
  'Not available': '不可用',
  'Superseded by real PTY': '已被真实 PTY 取代',
  'RPC mode: SDK backend (no process isolation)': 'RPC 模式：SDK 后端（无进程隔离）',
  'Mock RPC — isolation not simulated': '测试模式 — 未模拟隔离',
};

function localizeCapabilityNote(
  note: string | undefined,
  locale: DesktopLocale,
): string | undefined {
  if (!note) return undefined;
  if (locale === 'en') return note;
  return CAPABILITY_NOTE_ZH[note] ?? note;
}

function capabilityLabel(capabilityId: string, fallback: string, locale: DesktopLocale): string {
  if (locale === 'en') return CAPABILITY_LABEL_EN[capabilityId] ?? fallback;
  return CAPABILITY_LABEL_ZH[capabilityId] ?? fallback;
}

export function HostCapabilitiesCard(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const { hostStatus } = useSettings();
  const [open, setOpen] = useState(false);
  if (!hostStatus) {
    return null;
  }
  return (
    <div
      className="settings-section settings-section-card host-capabilities-card"
      data-testid="capability-matrix"
    >
      <button
        type="button"
        className="settings-collapsible-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="capability-matrix-toggle"
      >
        <PageTitle title={locale === 'zh-CN' ? 'Host 能力' : 'Host capabilities'} />
        <svg
          className={`settings-collapsible-chevron ${open ? 'open' : ''}`}
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

      <Collapse expanded={open} testId="capability-matrix-collapse">
        <ul className="capability-matrix-list">
          {buildCapabilityMatrix(hostStatus.capabilities, {
            mode: hostStatus.mode,
            mock: hostStatus.mock,
          }).map((row) => {
            const note = localizeCapabilityNote(row.note, locale);
            return (
              <li
                key={row.id}
                className={
                  row.available ? 'capability-row available' : 'capability-row unavailable'
                }
                data-testid={`capability-row-${row.id}`}
              >
                <span className="capability-mark" aria-hidden>
                  {row.available ? '●' : '○'}
                </span>
                <span className="capability-body">
                  <strong>{capabilityLabel(row.id, row.label, locale)}</strong>
                  {note ? <span className="muted"> — {note}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </Collapse>
    </div>
  );
}
