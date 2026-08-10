import type { ReactElement } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import { getThemeAsset } from './ink-wash-assets';

export function InkWashEmptyVignette(props: { theme: ThemeManifest }): ReactElement | null {
  const source = getThemeAsset(props.theme, 'emptySession');
  if (!source) return null;
  return (
    <img
      className="ink-wash-empty-vignette"
      src={source}
      alt=""
      aria-hidden="true"
      data-testid="ink-wash-empty-session"
      decoding="async"
    />
  );
}
