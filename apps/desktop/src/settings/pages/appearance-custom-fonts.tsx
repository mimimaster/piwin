import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Select } from '@piwin/ui-kit';
import type { DesktopCopy } from '../../desktop-locale.js';
import {
  saveDesktopPreferences,
  type CustomFontPreferences,
  type DesktopPreferences,
} from '../../ui-preferences.js';
import { FieldRow } from '../field-row.js';
import { parseFontMetadata } from '../../theme/font-parser.js';
import {
  deleteCustomFont,
  listCustomFonts,
  saveCustomFont,
  type StoredCustomFont,
} from '../../theme/font-storage.js';
import {
  applyCustomFontsToDocument,
  registerCustomFontInDocument,
} from '../../theme/font-manager.js';

export type AppearanceCustomFontsProps = {
  preferences: DesktopPreferences;
  onChange: (preferences: DesktopPreferences) => void;
  copy: DesktopCopy['appearance'];
  locale: 'zh-CN' | 'en';
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AppearanceCustomFonts({
  preferences,
  onChange,
  copy,
  locale,
}: AppearanceCustomFontsProps): ReactElement {
  const isZh = locale === 'zh-CN';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fonts, setFonts] = useState<StoredCustomFont[]>([]);
  const [uploading, setUploading] = useState(false);

  const refreshFonts = useCallback(async () => {
    try {
      const list = await listCustomFonts();
      setFonts(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshFonts();
  }, [refreshFonts]);

  const updateCustomFonts = useCallback(
    (nextFonts: CustomFontPreferences | undefined) => {
      const hasAny = nextFonts && Object.values(nextFonts).some((v) => Boolean(v && v !== 'default'));
      const cleaned: CustomFontPreferences | undefined = hasAny ? nextFonts : undefined;
      const nextPreferences: DesktopPreferences = {
        ...preferences,
        customFonts: cleaned,
      };
      onChange(nextPreferences);
      saveDesktopPreferences(nextPreferences);
      applyCustomFontsToDocument(cleaned);
    },
    [onChange, preferences],
  );

  const handleFontSelect = useCallback(
    (role: keyof CustomFontPreferences, value: string) => {
      const current = preferences.customFonts ?? {};
      const next: CustomFontPreferences = {
        ...current,
        [role]: value === 'default' ? undefined : value,
      };
      updateCustomFonts(next);
    },
    [preferences.customFonts, updateCustomFonts],
  );

  const handleFilesSelected = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    setUploading(true);
    try {
      const nextFonts: CustomFontPreferences = { ...(preferences.customFonts ?? {}) };
      let assignedAny = false;

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (!file) continue;
        const buffer = await file.arrayBuffer();
        const meta = parseFontMetadata(buffer, file.name);
        const stored = await saveCustomFont({
          family: meta.family,
          fileName: file.name,
          format: meta.format,
          data: buffer,
        });
        await registerCustomFontInDocument(stored);

        // Auto-assign roles on upload so fonts take effect immediately
        const lower = `${file.name} ${meta.family}`.toLowerCase();
        if (lower.includes('sans') && (!nextFonts.sansFont || nextFonts.sansFont === 'default')) {
          nextFonts.sansFont = meta.family;
          assignedAny = true;
        } else if ((lower.includes('mono') || lower.includes('code')) && (!nextFonts.monoFont || nextFonts.monoFont === 'default')) {
          nextFonts.monoFont = meta.family;
          assignedAny = true;
        } else if (lower.includes('serif') && (!nextFonts.serifFont || nextFonts.serifFont === 'default')) {
          nextFonts.serifFont = meta.family;
          assignedAny = true;
        }
      }

      // If single font uploaded and not auto-assigned by name keyword, activate as primary sans font
      if (!assignedAny && fileList.length === 1 && (!nextFonts.sansFont || nextFonts.sansFont === 'default')) {
        const firstFile = fileList[0];
        if (firstFile) {
          const meta = parseFontMetadata(await firstFile.arrayBuffer(), firstFile.name);
          nextFonts.sansFont = meta.family;
          assignedAny = true;
        }
      }

      if (assignedAny) {
        updateCustomFonts(nextFonts);
      }

      await refreshFonts();
    } catch (error) {
      console.warn('Failed to upload fonts:', error);
    } finally {
      setUploading(false);
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleDeleteFont = async (font: StoredCustomFont): Promise<void> => {
    await deleteCustomFont(font.id);
    const current = preferences.customFonts ?? {};
    let changed = false;
    const next = { ...current };

    if (next.sansFont === font.family) {
      delete next.sansFont;
      changed = true;
    }
    if (next.monoFont === font.family) {
      delete next.monoFont;
      changed = true;
    }
    if (next.serifFont === font.family) {
      delete next.serifFont;
      changed = true;
    }

    if (changed) {
      updateCustomFonts(next);
    }
    await refreshFonts();
  };

  const handleResetFonts = (): void => {
    updateCustomFonts(undefined);
  };

  const fontOptions = [
    { value: 'default', label: copy.defaultFont },
    ...fonts.map((f) => ({ value: f.family, label: f.family })),
  ];

  const currentSans = preferences.customFonts?.sansFont ?? 'default';
  const currentMono = preferences.customFonts?.monoFont ?? 'default';
  const currentSerif = preferences.customFonts?.serifFont ?? 'default';
  const hasCustomFont = currentSans !== 'default' || currentMono !== 'default' || currentSerif !== 'default';

  return (
    <div className="custom-fonts-section" data-testid="settings-custom-fonts">
      <FieldRow label={copy.sansFont} description={copy.sansFontDescription}>
        <Select
          value={currentSans}
          onChange={(e) => handleFontSelect('sansFont', e.currentTarget.value)}
          data={fontOptions}
          aria-label={copy.sansFont}
          testId="custom-sans-font-select"
        />
      </FieldRow>

      <FieldRow label={copy.monoFont} description={copy.monoFontDescription}>
        <Select
          value={currentMono}
          onChange={(e) => handleFontSelect('monoFont', e.currentTarget.value)}
          data={fontOptions}
          aria-label={copy.monoFont}
          testId="custom-mono-font-select"
        />
      </FieldRow>

      <FieldRow label={copy.serifFont} description={copy.serifFontDescription}>
        <Select
          value={currentSerif}
          onChange={(e) => handleFontSelect('serifFont', e.currentTarget.value)}
          data={fontOptions}
          aria-label={copy.serifFont}
          testId="custom-serif-font-select"
        />
      </FieldRow>

      <div className="custom-fonts-manager">
        <div className="custom-fonts-manager-header">
          <div className="custom-fonts-manager-title">
            <h4>{copy.uploadedFonts}</h4>
            <span className="custom-fonts-upload-hint">{copy.uploadFontHint}</span>
          </div>
          <div className="custom-fonts-manager-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => void handleFilesSelected(e)}
              data-testid="font-file-input"
            />
            <Button
              variant="secondary"
              size="compact"
              onClick={() => fileInputRef.current?.click()}
              data-testid="upload-font-button"
            >
              {uploading ? '...' : copy.uploadFont}
            </Button>
            {hasCustomFont ? (
              <Button
                variant="ghost"
                size="compact"
                onClick={handleResetFonts}
                data-testid="reset-fonts-button"
              >
                {copy.resetFonts}
              </Button>
            ) : null}
          </div>
        </div>

        {fonts.length === 0 ? (
          <div className="custom-fonts-empty-hint">{copy.noUploadedFonts}</div>
        ) : (
          <div className="custom-fonts-list">
            {fonts.map((font) => {
              const isSans = currentSans === font.family;
              const isMono = currentMono === font.family;
              const isSerif = currentSerif === font.family;

              return (
                <div key={font.id} className="custom-font-card" data-testid={`font-card-${font.family}`}>
                  <div className="custom-font-header">
                    <div className="custom-font-name-row">
                      <span className="custom-font-family-name">{font.family}</span>
                      <span className="custom-font-file-meta">
                        {font.fileName} ({formatFileSize(font.size)})
                      </span>
                    </div>
                    <div className="custom-font-badges">
                      {isSans ? <span className="custom-font-active-badge">Sans</span> : null}
                      {isMono ? <span className="custom-font-active-badge">Mono</span> : null}
                      {isSerif ? <span className="custom-font-active-badge">Serif</span> : null}
                    </div>
                  </div>

                  <div
                    className="custom-font-preview-line"
                    style={{ fontFamily: `"${font.family}", system-ui` }}
                  >
                    ABCDEFGHIJKLMN abcdefghijklmn 0123456789 永和九年，岁在癸丑
                  </div>

                  <div className="custom-font-footer-actions">
                    <div className="custom-font-assign-buttons">
                      <button
                        type="button"
                        className={`custom-font-pill-btn ${isSans ? 'is-active' : ''}`}
                        onClick={() => handleFontSelect('sansFont', isSans ? 'default' : font.family)}
                      >
                        {isZh ? '界面字体' : 'Sans'}
                      </button>
                      <button
                        type="button"
                        className={`custom-font-pill-btn ${isMono ? 'is-active' : ''}`}
                        onClick={() => handleFontSelect('monoFont', isMono ? 'default' : font.family)}
                      >
                        {isZh ? '代码字体' : 'Mono'}
                      </button>
                      <button
                        type="button"
                        className={`custom-font-pill-btn ${isSerif ? 'is-active' : ''}`}
                        onClick={() => handleFontSelect('serifFont', isSerif ? 'default' : font.family)}
                      >
                        {isZh ? '衬线字体' : 'Serif'}
                      </button>
                    </div>

                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => void handleDeleteFont(font)}
                      data-testid={`delete-font-${font.family}`}
                    >
                      {copy.deleteFont}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
