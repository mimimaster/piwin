/** Per-region opacity sliders for the native window material (macOS desktop). */
import type { ReactElement } from 'react';
import { Slider } from '@piwin/ui-kit';
import type { DesktopCopy } from '../../desktop-locale.js';
import { saveDesktopPreferences, type DesktopPreferences } from '../../ui-preferences.js';
import {
  DEFAULT_WINDOW_MATERIAL_OPACITY,
  WINDOW_MATERIAL_REGIONS,
  type WindowMaterialRegion,
} from '../../window-material-preferences.js';
import { FieldRow } from '../field-row.js';
import { PageTitle } from '../page-title.js';

function formatOpacity(value: number): string {
  return `${value}%`;
}

export function AppearanceWindowMaterial(props: {
  preferences: DesktopPreferences;
  onChange: (preferences: DesktopPreferences) => void;
  copy: DesktopCopy['appearance'];
}): ReactElement {
  const opacity = props.preferences.windowMaterial ?? DEFAULT_WINDOW_MATERIAL_OPACITY;
  const regionLabels: Record<WindowMaterialRegion, string> = {
    backdrop: props.copy.windowMaterialBackdrop,
    sidebar: props.copy.windowMaterialSidebar,
    stage: props.copy.windowMaterialStage,
    rightPanel: props.copy.windowMaterialRightPanel,
  };

  function withRegionOpacity(region: WindowMaterialRegion, value: number): DesktopPreferences {
    return { ...props.preferences, windowMaterial: { ...opacity, [region]: value } };
  }

  return (
    <section
      className="settings-section settings-section-card"
      data-testid="appearance-window-material"
    >
      <PageTitle
        title={props.copy.windowMaterial}
        description={props.copy.windowMaterialDescription}
      />
      {WINDOW_MATERIAL_REGIONS.map((region) => (
        <FieldRow key={region} label={regionLabels[region]}>
          <Slider
            className="appearance-window-material-slider"
            min={0}
            max={100}
            step={5}
            value={opacity[region]}
            label={formatOpacity}
            // Dragging repaints live; storage is only written once on release.
            onChange={(value) => props.onChange(withRegionOpacity(region, value))}
            onChangeEnd={(value) => saveDesktopPreferences(withRegionOpacity(region, value))}
            aria-label={regionLabels[region]}
            testId={`window-material-${region}`}
          />
        </FieldRow>
      ))}
    </section>
  );
}
