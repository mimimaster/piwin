/**
 * Settings → General page.
 * Unified application preferences: Appearance & Themes, General & Host Capabilities,
 * Keyboard Shortcuts, and Companion (Pet).
 */
import { lazy, Suspense, useState, type ReactElement } from 'react';
import { SegmentedControl, Spinner } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { settingsHostSupportsCommand, useSettings } from '../settings-context';
import { AppearancePage } from './appearance-page';
import { ShortcutsPage } from './shortcuts-page';
import { Collapse, Select } from '@piwin/ui-kit';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { buildCapabilityMatrix } from '@piwin/contracts';
import { getDesktopCopy, type DesktopLocale } from '../../desktop-locale';
import { AgentLocator } from '../../agent-locator.js';
import type { AgentLocatorAnimation } from '../../ui-preferences.js';
import { HostTargetSettings } from '../../host-target-settings';
import { MobileAccessSettings } from '../../mobile-access-settings';
import { useResetSettingsMainScroll } from '../use-reset-settings-scroll.js';

type GeneralSubTab = 'appearance' | 'general' | 'shortcuts' | 'pets';

const DeferredPetPanel = lazy(async () => {
  const module = await import('../../PetPanel');
  return { default: module.PetPanel };
});

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

function GeneralPreferencesSection(): ReactElement {
  const { locale, setLocale } = useDesktopLocale();
  const copy = getDesktopCopy(locale);
  const settings = useSettings();
  const { hostStatus } = settings;
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);

  return (
    <>
      <div className="settings-section settings-section-card" data-testid="settings-general-base">
        <PageTitle title={locale === 'zh-CN' ? '基础偏好' : 'General Preferences'} />
        <FieldRow label={copy.language} description={copy.languageDescription}>
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

      <HostTargetSettings />

      <MobileAccessSettings />

      {hostStatus ? (
        <div className="settings-section settings-section-card" data-testid="capability-matrix">
          <button
            type="button"
            className="settings-collapsible-trigger"
            onClick={() => setCapabilitiesOpen((v) => !v)}
            aria-expanded={capabilitiesOpen}
            data-testid="capability-matrix-toggle"
          >
            <PageTitle
              title={locale === 'zh-CN' ? 'Host 能力 (高级)' : 'Host capabilities (Advanced)'}
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
                    row.available ? 'capability-row available' : 'capability-row unavailable'
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
    </>
  );
}

function AnimationLocatorCard(): ReactElement {
  const { locale } = useDesktopLocale();
  const { preferences, onPreferencesChange } = useSettings();
  const isChinese = locale === 'zh-CN';
  const locatorAnimation = preferences.agentLocatorAnimation ?? 'radial-bellow';

  return (
    <div className="settings-section settings-section-card animation-locator-config" data-testid="settings-locator-animation">
      <PageTitle
        title={isChinese ? 'Agent 定位动效' : 'Agent locator animation'}
        description={
          isChinese
            ? '运行时在对话中显示的定位标记。'
            : 'The marker shown in the transcript while a run is active.'
        }
      />
      <div className="animation-locator-config-row" style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
        <SegmentedControl
          value={locatorAnimation}
          onChange={(value) => {
            if (
              value === 'radial-bellow' ||
              value === 'asterisk-breath' ||
              value === 'breath-dot' ||
              value === 'none'
            ) {
              const nextAnimation: AgentLocatorAnimation = value;
              onPreferencesChange({
                ...preferences,
                agentLocatorAnimation: nextAnimation,
              });
            }
          }}
          aria-label={isChinese ? 'Agent 定位动效' : 'Agent locator animation'}
          data={[
            { value: 'radial-bellow', label: isChinese ? '辐射风箱' : 'Radial bellow' },
            { value: 'asterisk-breath', label: isChinese ? '星芒呼吸' : 'Asterisk' },
            { value: 'breath-dot', label: isChinese ? '圆点呼吸' : 'Breath dot' },
            { value: 'none', label: isChinese ? '仅文字' : 'Text only' },
          ]}
          testId="agent-locator-animation-control"
        />
        <div className="animation-locator-preview" data-testid="agent-locator-preview">
          <AgentLocator
            input={{ kind: 'waiting-first-token', locale }}
            animation={locatorAnimation}
          />
        </div>
      </div>
    </div>
  );
}

export function GeneralPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const settings = useSettings();
  const { requestPet, onPetActiveChanged } = settings;
  const petsAvailable = settingsHostSupportsCommand(settings, 'pet/list');
  const [activeTab, setActiveTab] = useState<GeneralSubTab>('appearance');
  useResetSettingsMainScroll(activeTab);

  return (
    <div className="settings-card settings-hub-page general-hub-page" data-testid="settings-general">
      <div className="settings-hub-tabs">
        <SegmentedControl
          value={activeTab}
          onChange={(val) => setActiveTab(val as GeneralSubTab)}
          fullWidth
          data={[
            { value: 'appearance', label: isChinese ? '外观与主题' : 'Appearance' },
            { value: 'general', label: isChinese ? '基础设置' : 'General' },
            { value: 'shortcuts', label: isChinese ? '快捷键' : 'Shortcuts' },
            {
              value: 'pets',
              label: isChinese ? '灵动伴侣 (桌宠)' : 'Companion',
              disabled: !petsAvailable,
            },
          ]}
          testId="general-subtabs-control"
        />
      </div>

      <div className="settings-hub-panels">
      {activeTab === 'appearance' && (
        <div data-testid="general-tab-appearance">
          <AppearancePage />
          <div style={{ marginTop: 16 }}>
            <AnimationLocatorCard />
          </div>
        </div>
      )}

      {activeTab === 'general' && (
        <div data-testid="general-tab-base">
          <GeneralPreferencesSection />
        </div>
      )}

      {activeTab === 'shortcuts' && (
        <div data-testid="general-tab-shortcuts">
          <ShortcutsPage />
        </div>
      )}

      {activeTab === 'pets' && (
        <div className="settings-card" data-testid="general-tab-pets">
          <Suspense
            fallback={
              <div className="deferred-surface-fallback" data-testid="settings-pets-loading">
                <Spinner label={isChinese ? '正在加载灵动伴侣' : 'Loading companion'} />
              </div>
            }
          >
            <DeferredPetPanel
              request={requestPet}
              onActiveChanged={onPetActiveChanged}
              variant="inline"
            />
          </Suspense>
        </div>
      )}
      </div>
    </div>
  );
}
