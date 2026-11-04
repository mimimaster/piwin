/**
 * Phone activity chip: the collapsed-workbench Browser indicator for layouts
 * that cannot host the floating mini (spec §7).
 *
 * It is a chip, not a preview: tapping opens the Browser surface where typing,
 * picking, and dialogs work. It sits in the dock above the composer, so it never
 * covers the transcript or the input the way a draggable window would.
 */
import type { ReactElement } from 'react';
import type { DesktopLocale } from '../i18n/desktop-locale';

export type BrowserActivityChipProps = {
  locale: DesktopLocale;
  /** The agent holds the browser right now; the chip says so. */
  agentDriving: boolean;
  /** Page title or host, already resolved for display. */
  title: string;
  onOpen: () => void;
};

export function BrowserActivityChip(props: BrowserActivityChipProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const label = props.agentDriving
    ? zh
      ? 'AI 正在操作浏览器'
      : 'Agent is driving the browser'
    : zh
      ? '浏览器'
      : 'Browser';
  return (
    <div className="browser-activity-chip-row">
      <button
        type="button"
        className="browser-activity-chip"
        data-testid="browser-activity-chip"
        data-agent-driving={props.agentDriving ? 'true' : 'false'}
        aria-label={zh ? `${label}，打开浏览器` : `${label}, open browser`}
        onClick={props.onOpen}
      >
        <span className="browser-activity-chip-dot" aria-hidden="true" />
        <span className="browser-activity-chip-label">{label}</span>
        {props.title.length > 0 ? (
          <span className="browser-activity-chip-title">{props.title}</span>
        ) : null}
      </button>
    </div>
  );
}
