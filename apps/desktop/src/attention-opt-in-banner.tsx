import type { ReactElement } from 'react';
import type { DesktopLocale } from './desktop-locale';

export function AttentionOptInBanner(props: {
  visible: boolean;
  locale: DesktopLocale;
  onEnable: () => void;
  onDismiss: () => void;
}): ReactElement | null {
  void props;
  throw new Error('AN-U2 not implemented');
}
