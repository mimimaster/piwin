/**
 * Settings → Connection & Devices: which Host this window talks to, how phones
 * and other shells reach it (pairing, relay), and the Host's network proxy.
 * Split out of General so preferences and connectivity no longer share a page.
 */
import { useState, type ReactElement } from 'react';
import { SegmentedControl } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../i18n/desktop-locale-context';
import { HostTargetSettings } from '../../host/host-target-settings';
import { MobileAccessSettings } from '../../devices/mobile-access-settings';
import { isMobileTauriRuntime } from '../../tool-cards/shell-runtime';
import { HostCapabilitiesCard } from '../host-capabilities-card';
import { NetworkProxySettings } from '../network-proxy-settings';
import { useResetSettingsMainScroll } from '../use-reset-settings-scroll.js';

type ConnectionSubTab = 'host' | 'phone' | 'proxy';

export function ConnectionPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  // Pairing a phone is an operator task done at the computer.
  const showPhoneAccess = !isMobileTauriRuntime();
  // Pairing a phone is what most people come here for.
  const [activeTab, setActiveTab] = useState<ConnectionSubTab>(showPhoneAccess ? 'phone' : 'host');
  useResetSettingsMainScroll(activeTab);

  return (
    <div className="settings-card settings-hub-page" data-testid="settings-connection">
      <div className="settings-hub-tabs">
        <SegmentedControl
          value={activeTab}
          onChange={(value) => setActiveTab(value as ConnectionSubTab)}
          fullWidth
          data={[
            ...(showPhoneAccess
              ? [{ value: 'phone', label: isChinese ? '手机与远程访问' : 'Phone & remote access' }]
              : []),
            { value: 'host', label: isChinese ? '当前 Host' : 'Host' },
            { value: 'proxy', label: isChinese ? '网络代理' : 'Network proxy' },
          ]}
          testId="connection-subtabs-control"
        />
      </div>

      <div className="settings-hub-panels">
        {activeTab === 'host' ? (
          <div data-testid="connection-tab-host">
            <HostTargetSettings />
            <HostCapabilitiesCard />
          </div>
        ) : null}
        {activeTab === 'phone' && showPhoneAccess ? (
          <div data-testid="connection-tab-phone">
            <MobileAccessSettings />
          </div>
        ) : null}
        {activeTab === 'proxy' ? (
          <div data-testid="connection-tab-proxy">
            <NetworkProxySettings />
          </div>
        ) : null}
      </div>
    </div>
  );
}
