/**
 * Settings → Shortcuts — read-only keyboard shortcut reference.
 * Layout inspired by modern IDE settings (grouped rows + discrete keycaps).
 */
import type { ReactElement } from 'react';
import {
  SHORTCUT_CATALOG,
  detectShortcutDisplayPlatform,
  formatShortcutChordTokens,
} from '../../desktop-shortcut-catalog';
import { useDesktopLocale } from '../../desktop-locale-context';

function ShortcutKeycaps(props: { chord: string; pcChord?: string }): ReactElement {
  const platform = detectShortcutDisplayPlatform();
  const chord = platform === 'pc' && props.pcChord ? props.pcChord : props.chord;
  const tokens = formatShortcutChordTokens(chord, platform);
  return (
    <span className="shortcut-keycaps" aria-label={tokens.join(' + ')}>
      {tokens.map((token, tokenIndex) => (
        <kbd key={`${token}-${tokenIndex}`} className="shortcut-keycap">
          {token}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';

  return (
    <div className="settings-card" data-testid="settings-shortcuts">
      <div className="settings-section settings-section-card shortcuts-page">
        <div className="shortcuts-groups">
          {SHORTCUT_CATALOG.map((group) => (
            <section
              key={group.id}
              className="shortcuts-group"
              data-testid={`shortcuts-group-${group.id}`}
              aria-labelledby={`shortcuts-group-${group.id}-label`}
            >
              <h5 className="shortcuts-group-label" id={`shortcuts-group-${group.id}-label`}>
                {isChinese ? group.labelZh : group.labelEn}
              </h5>
              <ul className="shortcuts-list">
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="shortcuts-row"
                    data-testid={`shortcut-row-${entry.id}`}
                  >
                    <span className="shortcuts-row-title">
                      {isChinese ? entry.titleZh : entry.titleEn}
                    </span>
                    <ShortcutKeycaps
                      chord={entry.chord}
                      {...(entry.pcChord ? { pcChord: entry.pcChord } : {})}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="shortcuts-footnote muted">
          {isChinese
            ? 'Windows / Linux 上 ⌘ 显示为 Ctrl。Chat 分窗快捷键在输入框中也会触发；其余操作快捷键仍会避开输入。'
            : 'On Windows / Linux, ⌘ is shown as Ctrl. Chat pane shortcuts also work while typing; other action shortcuts still avoid text fields.'}
        </p>
      </div>
    </div>
  );
}
