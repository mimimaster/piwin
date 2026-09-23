/**
 * Settings → Artifact.
 * Render policy first, then the playground. One nav item, two panes.
 */
import { useState, type ReactElement } from 'react';
import { SegmentedControl } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useResetSettingsMainScroll } from '../use-reset-settings-scroll.js';
import { ArtifactPage } from './artifact-page';
import { ArtifactPlaygroundPage } from './artifact-playground-page';

type ArtifactSubTab = 'render' | 'playground';

export function ArtifactSettingsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [activeTab, setActiveTab] = useState<ArtifactSubTab>('render');
  useResetSettingsMainScroll(activeTab);

  return (
    <div className="settings-card settings-hub-page" data-testid="settings-artifact-hub">
      <div className="settings-hub-tabs">
        <SegmentedControl
          value={activeTab}
          onChange={(value) => setActiveTab(value as ArtifactSubTab)}
          data={[
            { value: 'render', label: 'Artifact' },
            { value: 'playground', label: isChinese ? '实验场' : 'Playground' },
          ]}
          testId="artifact-subtabs-control"
        />
      </div>

      <div className="settings-hub-panels">
        {activeTab === 'render' ? (
          <div data-testid="artifact-tab-render">
            <ArtifactPage />
          </div>
        ) : (
          <div data-testid="artifact-tab-playground">
            <ArtifactPlaygroundPage />
          </div>
        )}
      </div>
    </div>
  );
}
