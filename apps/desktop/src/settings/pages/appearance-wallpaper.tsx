/** Wallpaper upload, removal and dressing (blur, dim) behind the desktop shell. */
import { useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Slider } from '@piwin/ui-kit';
import type { DesktopCopy } from '../../i18n/desktop-locale.js';
import { saveDesktopPreferences, type DesktopPreferences } from '../../platform/ui-preferences.js';
import {
  createWallpaperPreferences,
  WALLPAPER_BLUR_MAX,
  WALLPAPER_DIM_MAX,
  type WallpaperPreferences,
} from '../../platform/wallpaper-preferences.js';
import {
  deleteWallpaperImage,
  prepareWallpaperBlob,
  saveWallpaperImage,
} from '../../platform/wallpaper-storage.js';
import { FieldRow } from '../field-row.js';
import { PageTitle } from '../page-title.js';

export function AppearanceWallpaper(props: {
  preferences: DesktopPreferences;
  onChange: (preferences: DesktopPreferences) => void;
  copy: DesktopCopy['appearance'];
}): ReactElement {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const wallpaper = props.preferences.wallpaper;

  function commit(next: DesktopPreferences): void {
    props.onChange(next);
    saveDesktopPreferences(next);
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const id = await saveWallpaperImage(await prepareWallpaperBlob(file));
      const previous = wallpaper;
      // Replacing keeps the user's blur / dim / opacity tuning.
      const next: WallpaperPreferences = previous
        ? { ...previous, id }
        : createWallpaperPreferences(id);
      commit({ ...props.preferences, wallpaper: next });
      if (previous) {
        void deleteWallpaperImage(previous.id);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function removeWallpaper(): void {
    if (!wallpaper) {
      return;
    }
    const { wallpaper: removed, ...rest } = props.preferences;
    commit(rest);
    void deleteWallpaperImage(removed?.id ?? wallpaper.id);
  }

  function withDressing(key: 'blur' | 'dim', value: number): DesktopPreferences | undefined {
    return wallpaper
      ? { ...props.preferences, wallpaper: { ...wallpaper, [key]: value } }
      : undefined;
  }

  return (
    <section className="settings-section settings-section-card" data-testid="appearance-wallpaper">
      <PageTitle title={props.copy.wallpaper} description={props.copy.wallpaperDescription} />
      <FieldRow label={props.copy.wallpaperImage}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(event) => void handleFileSelected(event)}
          data-testid="wallpaper-file-input"
        />
        <div className="custom-fonts-manager-actions">
          <Button
            variant="secondary"
            size="compact"
            onClick={() => fileInputRef.current?.click()}
            data-testid="wallpaper-upload-button"
          >
            {busy ? '...' : wallpaper ? props.copy.wallpaperChange : props.copy.wallpaperUpload}
          </Button>
          {wallpaper ? (
            <Button
              variant="ghost"
              size="compact"
              onClick={removeWallpaper}
              data-testid="wallpaper-remove-button"
            >
              {props.copy.wallpaperRemove}
            </Button>
          ) : null}
        </div>
        {failed ? <span role="alert">{props.copy.wallpaperError}</span> : null}
      </FieldRow>
      {wallpaper ? (
        <>
          <FieldRow label={props.copy.wallpaperBlur}>
            <Slider
              className="appearance-window-material-slider"
              min={0}
              max={WALLPAPER_BLUR_MAX}
              step={1}
              value={wallpaper.blur}
              label={(value) => `${value}px`}
              onChange={(value) => {
                const next = withDressing('blur', value);
                if (next) props.onChange(next);
              }}
              onChangeEnd={(value) => {
                const next = withDressing('blur', value);
                if (next) saveDesktopPreferences(next);
              }}
              aria-label={props.copy.wallpaperBlur}
              testId="wallpaper-blur"
            />
          </FieldRow>
          <FieldRow label={props.copy.wallpaperDim}>
            <Slider
              className="appearance-window-material-slider"
              min={0}
              max={WALLPAPER_DIM_MAX}
              step={5}
              value={wallpaper.dim}
              label={(value) => `${value}%`}
              onChange={(value) => {
                const next = withDressing('dim', value);
                if (next) props.onChange(next);
              }}
              onChangeEnd={(value) => {
                const next = withDressing('dim', value);
                if (next) saveDesktopPreferences(next);
              }}
              aria-label={props.copy.wallpaperDim}
              testId="wallpaper-dim"
            />
          </FieldRow>
        </>
      ) : null}
    </section>
  );
}
