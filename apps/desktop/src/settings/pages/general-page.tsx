/**
 * Settings → General page.
 * Application preferences: General, Appearance & Themes, Keyboard Shortcuts,
 * Health and Companion (Pet). Host, phone access and proxy live on the
 * Connection page.
 */
import { lazy, Suspense, useState, type ReactElement } from 'react';
import { SegmentedControl, Spinner } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { settingsHostSupportsCommand, useSettings } from '../settings-context';
import { AppearancePage } from './appearance-page';
import { ShortcutsPage } from './shortcuts-page';
import { Select } from '@piwin/ui-kit';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { getDesktopCopy, type DesktopLocale } from '../../i18n/desktop-locale';
import { AgentLocator } from '../../agents/agent-locator.js';
import type { AgentLocatorAnimation } from '../../platform/ui-preferences.js';
import { DeviceHealthSettings } from '../../devices/device-health-settings';
import { HostHealthSettings } from '../host-health-settings';
import { ShellInterfaceSettings } from '../../tool-cards/shell-interface-settings';
import { AppVersionSettings } from '../../platform/app-version-settings';
import { isMobileTauriRuntime } from '../../tool-cards/shell-runtime';
import { useResetSettingsMainScroll } from '../use-reset-settings-scroll.js';

type GeneralSubTab = 'appearance' | 'general' | 'shortcuts' | 'health' | 'pets';

const DeferredPetPanel = lazy(async () => {
  const module = await import('../../pet/PetPanel');
  return { default: module.PetPanel };
});

function GeneralPreferencesSection(): ReactElement {
  const { locale, setLocale } = useDesktopLocale();
  const copy = getDesktopCopy(locale);

  return (
    <>
      <div
        className="settings-section settings-section-card general-card"
        data-testid="settings-general-base"
      >
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

      <AppVersionSettings />
      <ShellInterfaceSettings />
    </>
  );
}

function AnimationLocatorCard(): ReactElement {
  const { locale } = useDesktopLocale();
  const { preferences, onPreferencesChange } = useSettings();
  const isChinese = locale === 'zh-CN';
  const locatorAnimation = preferences.agentLocatorAnimation ?? 'radial-bellow';

  return (
    <div
      className="settings-section settings-section-card animation-locator-config"
      data-testid="settings-locator-animation"
    >
      <PageTitle
        title={isChinese ? 'Agent 定位动效' : 'Agent locator animation'}
        description={
          isChinese
            ? '运行时在对话中显示的定位标记。'
            : 'The marker shown in the transcript while a run is active.'
        }
      />
      <div
        className="animation-locator-config-row"
        style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}
      >
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
  // A phone has no keyboard shortcuts or desktop companion to configure.
  const onPhone = isMobileTauriRuntime();
  const petsAvailable = settingsHostSupportsCommand(settings, 'pet/list');
  const [activeTab, setActiveTab] = useState<GeneralSubTab>('general');
  useResetSettingsMainScroll(activeTab);

  return (
    <div
      className="settings-card settings-hub-page general-hub-page"
      data-testid="settings-general"
    >
      <div className="settings-hub-tabs">
        <SegmentedControl
          value={activeTab}
          onChange={(val) => setActiveTab(val as GeneralSubTab)}
          fullWidth
          data={[
            { value: 'general', label: isChinese ? '基础设置' : 'General' },
            { value: 'appearance', label: isChinese ? '外观与主题' : 'Appearance' },
            ...(onPhone
              ? []
              : [{ value: 'shortcuts', label: isChinese ? '快捷键' : 'Shortcuts' }]),
            { value: 'health', label: isChinese ? '健康' : 'Health' },
            ...(onPhone
              ? []
              : [
                  {
                    value: 'pets',
                    label: isChinese ? '桌宠' : 'Companion',
                    disabled: !petsAvailable,
                  },
                ]),
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

        {activeTab === 'health' && (
          <div data-testid="general-tab-health">
            <DeviceHealthSettings />
            <HostHealthSettings />
          </div>
        )}

        {activeTab === 'pets' && (
          <div className="settings-card" data-testid="general-tab-pets">
            <Suspense
              fallback={
                <div className="deferred-surface-fallback" data-testid="settings-pets-loading">
                  <Spinner label={isChinese ? '正在加载桌宠' : 'Loading companion'} />
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
