import type { ReactElement } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import { getThemeAsset } from './ink-wash-assets';

export function InkWashEmptyVignette(props: { theme: ThemeManifest }): ReactElement | null {
  const source = getThemeAsset(props.theme, 'emptySession');
  const sealSource = getThemeAsset(props.theme, 'agentSeal');
  if (!source) return null;

  return (
    <div className="ink-wash-vignette-frame" data-testid="ink-wash-empty-session">
      <div className="ink-wash-vignette-art-wrapper">
        <img
          className="ink-wash-empty-vignette"
          src={source}
          alt=""
          aria-hidden="true"
          decoding="async"
        />
        {sealSource ? (
          <img
            className="ink-wash-agent-seal-stamp"
            src={sealSource}
            alt="砚"
            title="piwinwin 砚"
            decoding="async"
          />
        ) : null}
      </div>
      <span className="ink-wash-poetic-badge">泼墨写意 · 深夜书案</span>
    </div>
  );
}
