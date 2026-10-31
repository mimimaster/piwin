import type { ReactElement } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import {
  buildAppearanceTheme,
  INKSTONE_LIGHT_PRESETS,
  resolveSystemThemeMode,
  type InkstoneLightPresetMeta,
} from '../../theme/appearance-tokens.js';
import {
  createLightPresetSettings,
  saveDesktopPreferences,
  type DesktopPreferences,
} from '../../platform/ui-preferences.js';

export function AppearanceLightPresets(props: {
  preferences: DesktopPreferences;
  onChange: (preferences: DesktopPreferences) => void;
  onThemeApplied: (theme: ThemeManifest) => void;
  activeTheme: ThemeManifest;
  locale: 'zh-CN' | 'en';
}): ReactElement {
  const currentPresetId = (() => {
    const current = props.preferences.lightTheme;
    if (current?.preset === 'paper') {
      return 'paper';
    }
    const bg = current?.background?.toLowerCase();
    if (bg && bg === INKSTONE_LIGHT_PRESETS[1]?.manifest.tokens.bg.toLowerCase()) {
      return 'paper';
    }
    return 'modern';
  })();

  function handleSelect(preset: InkstoneLightPresetMeta): void {
    const nextSettings = createLightPresetSettings(preset.id);
    const nextPreferences: DesktopPreferences = {
      ...props.preferences,
      lightTheme: nextSettings,
    };
    props.onChange(nextPreferences);
    saveDesktopPreferences(nextPreferences);

    const mode =
      props.preferences.appearanceMode === 'system'
        ? resolveSystemThemeMode()
        : props.preferences.appearanceMode;

    if (mode === 'light') {
      props.onThemeApplied(buildAppearanceTheme('light', nextSettings));
    }

    if (preset.id === 'modern') {
      if (typeof window !== 'undefined') {
        try {
          window.localStorage?.setItem('piwin:slab-material', 'paper');
        } catch {
          // ignore
        }
      }
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-slab', 'paper');
        const app = document.getElementById('app');
        if (app) app.setAttribute('data-slab', 'paper');
      }
    }
  }

  const title = props.locale === 'zh-CN' ? '纸面色调' : 'Paper Tone';
  const description =
    props.locale === 'zh-CN'
      ? '选择浅色模式的纸面基调，换个清爽心情'
      : 'Select the light theme tone and ambiance';

  return (
    <section className="settings-section settings-section-card appearance-light-presets-section">
      <div className="appearance-presets-header">
        <h4 className="appearance-presets-title">{title}</h4>
        <p className="appearance-presets-description">{description}</p>
      </div>
      <div className="appearance-presets-grid" role="radiogroup" aria-label={title}>
        {INKSTONE_LIGHT_PRESETS.map((preset) => {
          const isSelected = currentPresetId === preset.id;
          const name = props.locale === 'zh-CN' ? preset.nameZh : preset.nameEn;
          const desc = props.locale === 'zh-CN' ? preset.descriptionZh : preset.descriptionEn;
          const deck = preset.manifest.deck!;

          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`appearance-preset-card ${isSelected ? 'is-selected' : ''}`}
              onClick={() => handleSelect(preset)}
              style={
                {
                  '--card-preset-void': deck.void,
                  '--card-preset-s1': deck.surface1,
                  '--card-preset-s2': deck.surface2,
                  '--card-preset-text': deck.text1,
                  '--card-preset-iris': deck.iris,
                  '--card-preset-slab': preset.slabBg,
                } as React.CSSProperties
              }
              data-testid={`light-preset-${preset.id}`}
            >
              <div className="appearance-preset-preview">
                <div className="preset-swatch-canvas">
                  <div className="preset-swatch-stage">
                    <span className="preset-swatch-dot preset-dot-accent" />
                    <span className="preset-swatch-dot preset-dot-text" />
                  </div>
                  <div className="preset-swatch-slab" />
                </div>
              </div>
              <div className="appearance-preset-info">
                <div className="appearance-preset-name-row">
                  <span className="appearance-preset-name">{name}</span>
                  {isSelected && <span className="appearance-preset-badge" aria-hidden="true" />}
                </div>
                <span className="appearance-preset-desc">{desc}</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
