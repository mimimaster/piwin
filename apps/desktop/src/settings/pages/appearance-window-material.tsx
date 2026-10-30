/** Per-region opacity sliders for the native window material or the wallpaper. */
import type { ReactElement } from 'react';
import { Slider } from '@piwin/ui-kit';
import type { DesktopCopy } from '../../i18n/desktop-locale.js';
import { saveDesktopPreferences, type DesktopPreferences } from '../../platform/ui-preferences.js';
import {
  DEFAULT_PHONE_GLASS,
  DEFAULT_WINDOW_MATERIAL_OPACITY,
  WINDOW_MATERIAL_REGIONS,
  type WindowMaterialRegion,
} from '../../platform/window-material-preferences.js';
import { FieldRow } from '../field-row.js';
import { PageTitle } from '../page-title.js';

function formatOpacity(value: number): string {
  return `${value}%`;
}

export function AppearanceWindowMaterial(props: {
  preferences: DesktopPreferences;
  onChange: (preferences: DesktopPreferences) => void;
  copy: DesktopCopy['appearance'];
  /** Phone layout: one glass-strength slider instead of the per-region set. */
  phone?: boolean;
}): ReactElement {
  if (props.phone) {
    const strength = props.preferences.phoneGlass ?? DEFAULT_PHONE_GLASS;
    const withStrength = (value: number): DesktopPreferences => ({ ...props.preferences, phoneGlass: value });
    return (
      <section className="settings-section settings-section-card" data-testid="appearance-phone-glass">
        <PageTitle title={props.copy.windowMaterial} description={props.copy.phoneGlassDescription} />
        <FieldRow label={props.copy.windowMaterial}>
          <Slider
            className="appearance-window-material-slider"
            min={0}
            max={100}
            step={5}
            value={strength}
            label={formatOpacity}
            onChange={(value) => props.onChange(withStrength(value))}
            onChangeEnd={(value) => saveDesktopPreferences(withStrength(value))}
            aria-label={props.copy.windowMaterial}
            testId="phone-glass-strength"
          />
        </FieldRow>
      </section>
    );
  }
  // While a wallpaper is set the sliders tune its own, clearer opacity set;
  // the regular set is kept as it was and returns when the wallpaper is removed.
  const wallpaper = props.preferences.wallpaper;
  const opacity =
    wallpaper?.opacity ?? props.preferences.windowMaterial ?? DEFAULT_WINDOW_MATERIAL_OPACITY;
  const regionLabels: Record<WindowMaterialRegion, string> = {
    backdrop: props.copy.windowMaterialBackdrop,
    sidebar: props.copy.windowMaterialSidebar,
    stage: props.copy.windowMaterialStage,
    rightPanel: props.copy.windowMaterialRightPanel,
  };

  function withRegionOpacity(region: WindowMaterialRegion, value: number): DesktopPreferences {
    const next = { ...opacity, [region]: value };
    return wallpaper
      ? { ...props.preferences, wallpaper: { ...wallpaper, opacity: next } }
      : { ...props.preferences, windowMaterial: next };
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
