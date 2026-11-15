/**
 * Antigravity brand mark (Google Antigravity).
 * Official arch glyph from Antigravity.app and gradient avatar.
 */
import type { CSSProperties, ReactElement } from 'react';
import type { BrandIcon } from './provider-brands-icons.js';

type MarkProps = {
  size?: number | string;
  style?: CSSProperties;
  className?: string;
};

const ANTIGRAVITY_PATH =
  'M144.248 149.062C151.748 154.688 162.998 150.938 152.685 140.625C121.748 110.625 128.31 28.125 89.8727 28.125C51.4352 28.125 57.9977 110.625 27.0602 140.625C15.8102 151.875 27.9977 154.688 35.4977 149.062C64.5602 129.375 62.6852 94.6875 89.8727 94.6875C117.06 94.6875 115.185 129.375 144.248 149.062Z';

function AntigravityGlyph(props: MarkProps): ReactElement {
  const size = props.size ?? '1em';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 180 180"
      fill="currentColor"
      className={props.className}
      style={{ display: 'block', flex: 'none', ...props.style }}
      aria-hidden
    >
      <path d={ANTIGRAVITY_PATH} />
    </svg>
  );
}

function AntigravityAvatar(props: MarkProps): ReactElement {
  const size = props.size ?? '1em';
  return (
    <div
      style={{
        alignItems: 'center',
        background: '#ffffff',
        borderRadius: '50%',
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.06) inset',
        display: 'flex',
        flex: 'none',
        height: size,
        justifyContent: 'center',
        overflow: 'hidden',
        width: size,
        ...props.style,
      }}
      className={props.className}
      aria-label="Antigravity"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 180 180"
        fill="none"
        style={{ display: 'block', flex: 'none', transform: 'scale(0.72)' }}
        aria-hidden
      >
        <defs>
          <linearGradient id="antigravity-avatar-grad" x1="20" y1="150" x2="160" y2="30" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4285F4" />
            <stop offset="35%" stopColor="#34A853" />
            <stop offset="65%" stopColor="#FBBC05" />
            <stop offset="100%" stopColor="#EA4335" />
          </linearGradient>
        </defs>
        <path d={ANTIGRAVITY_PATH} fill="url(#antigravity-avatar-grad)" />
      </svg>
    </div>
  );
}

export const AntigravityIcon: BrandIcon = Object.assign(AntigravityGlyph, {
  Avatar: AntigravityAvatar,
  Color: AntigravityGlyph,
  colorPrimary: '#4285f4',
  title: 'Antigravity',
});
