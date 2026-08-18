import type { ReactElement } from 'react';
import type { PluginMarketplaceIconId } from './plugin-marketplace-catalog.js';

type MarketplaceIconProps = {
  icon: PluginMarketplaceIconId;
};

export function PluginMarketplaceIcon(props: MarketplaceIconProps): ReactElement {
  const className = `plugin-market-icon plugin-market-icon--${props.icon}`;
  return (
    <span className={className} aria-hidden="true">
      {iconSvg(props.icon)}
    </span>
  );
}

function iconSvg(icon: PluginMarketplaceIconId): ReactElement {
  if (icon === 'github') {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.36 6.84 9.72.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.27 2.75 1.05A9.3 9.3 0 0 1 12 6.84c.85 0 1.71.12 2.51.35 1.9-1.32 2.74-1.05 2.74-1.05.55 1.4.21 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z" />
      </svg>
    );
  }
  if (icon === 'remotion') {
    return (
      <svg viewBox="0 0 32 32" width="22" height="22">
        <rect width="32" height="32" rx="8" fill="#0B84F3" />
        <path d="M12.5 9.5v13l11-6.5-11-6.5Z" fill="#fff" />
      </svg>
    );
  }
  if (icon === 'hyperframes') {
    return (
      <svg viewBox="0 0 32 32" width="22" height="22">
        <rect width="32" height="32" rx="8" fill="#12B981" />
        <path
          d="M9 10.5h14v11H9v-11Zm2 2v7h10v-7H11Zm3.5 1.5 5 3.5-5 3.5v-7Z"
          fill="#fff"
        />
      </svg>
    );
  }
  if (icon === 'figma') {
    return (
      <svg viewBox="0 0 16 24" width="14" height="22">
        <path fill="#F24E1E" d="M8 0H0v8h8a4 4 0 0 0 0-8Z" />
        <path fill="#FF7262" d="M0 8h8v8H0Z" />
        <path fill="#A259FF" d="M16 0H8a4 4 0 0 0 0 8h8V0Z" />
        <path fill="#1ABCFE" d="M16 8H8a4 4 0 0 0 0 8h4a4 4 0 0 0 4-4V8Z" />
        <path fill="#0ACF83" d="M0 16h8a4 4 0 1 1-4 4 4 4 0 0 1-4-4Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" width="22" height="22">
      <rect width="32" height="32" rx="8" fill="#F38020" />
      <path
        d="M8.2 19.6c.3-3.1 2.9-5.4 6-5.2.5-2.6 2.8-4.5 5.5-4.5 3.1 0 5.6 2.5 5.6 5.6 0 .3 0 .6-.1.8 1.7.4 3 2 3 3.8 0 2.2-1.8 3.9-3.9 3.9H11.6c-2 0-3.7-1.6-3.7-3.6 0-.3 0-.5.1-.8Z"
        fill="#fff"
      />
    </svg>
  );
}
