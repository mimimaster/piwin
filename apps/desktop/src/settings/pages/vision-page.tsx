/**
 * Settings → Vision page.
 * Hosts Vision Delegation configuration, extracted from the Models page.
 */
import type { ReactElement } from 'react';
import { VisionDelegationSettings } from '../../VisionDelegationSettings';

export function VisionPage(): ReactElement {
  return (
    <div className="settings-section settings-section-card" data-testid="settings-vision-page">
      <VisionDelegationSettings />
    </div>
  );
}
