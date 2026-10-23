import type { ReactElement } from 'react';
import { Button, IconDesktop, IconTerminal } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale.js';

/** Two shell views of the same conversation: two square cells forming one pill. */
export function ConversationShellSwitch(props: {
  cli: boolean;
  busy?: boolean;
  locale: DesktopLocale;
  appearanceMode: 'light' | 'dark';
  onDesktop: () => void;
  onCli: () => void;
  onCliIntent?: (() => void) | undefined;
}): ReactElement {
  const chinese = props.locale === 'zh-CN';
  return (
    <span className="seg conversation-shell-switch" role="group"
      aria-label={chinese ? '会话界面' : 'Conversation interface'}
      aria-busy={props.busy === true} data-appearance={props.appearanceMode} data-testid="conversation-shell-switch">
      <Button variant="ghost" size="compact" className={props.cli ? '' : 'on'}
        data-testid="conversation-shell-desktop" aria-pressed={!props.cli}
        aria-label={chinese ? 'Desktop 界面' : 'Desktop interface'}
        title={chinese ? 'Desktop · 桌面界面' : 'Desktop interface'}
        onClick={() => { if (props.cli) props.onDesktop(); }}>
        <IconDesktop size={14} stroke={1.6} className="shell-glyph" />
      </Button>
      <Button variant="ghost" size="compact" className={props.cli ? 'on' : ''}
        data-testid="conversation-shell-cli" aria-pressed={props.cli}
        onPointerEnter={props.onCliIntent} onFocus={props.onCliIntent}
        aria-label={chinese ? 'CLI 界面' : 'CLI interface'}
        title={chinese ? 'CLI · 终端界面' : 'CLI interface'}
        onClick={() => { if (!props.cli) props.onCli(); }}>
        <IconTerminal size={14} stroke={1.6} className="shell-glyph" />
      </Button>
    </span>
  );
}
