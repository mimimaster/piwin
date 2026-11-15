/**
 * Renders a session-backend vendor mark from an extension's `piwin.json`
 * (`sessionBackend.icon`), reusing `ProviderIcon` for known brands and safe
 * structured SVG `<path>` elements for custom monochrome glyphs.
 */
import type { CSSProperties, ReactElement } from 'react';
import type { ExtensionSessionBackendIcon } from '@piwin/contracts';
import { ProviderIcon } from './provider-icon.js';

export type SessionBackendIconProps = {
  icon: ExtensionSessionBackendIcon;
  name?: string;
  size?: number;
  variant?: 'glyph' | 'avatar';
  className?: string;
  style?: CSSProperties;
};

export function SessionBackendIcon(props: SessionBackendIconProps): ReactElement {
  const size = props.size ?? 12;
  const variant = props.variant ?? 'glyph';

  if (props.icon.kind === 'brand') {
    return (
      <ProviderIcon
        id={props.icon.id}
        {...(props.name !== undefined ? { name: props.name } : {})}
        size={size}
        variant={variant}
        {...(props.className !== undefined ? { className: props.className } : {})}
        {...(props.style !== undefined ? { style: props.style } : {})}
      />
    );
  }

  const glyphSize = variant === 'avatar' ? Math.round(size * 0.58) : size;
  const radius = Math.max(6, Math.round(size * 0.28));
  const svg = (
    <svg
      width={glyphSize}
      height={glyphSize}
      viewBox={props.icon.viewBox}
      fill="currentColor"
      fillRule={props.icon.fillRule}
      aria-hidden="true"
      style={{ width: glyphSize, height: glyphSize, display: 'block', flexShrink: 0 }}
    >
      {props.icon.paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );

  if (variant === 'avatar') {
    return (
      <span
        className={['session-backend-icon', 'is-avatar', props.className].filter(Boolean).join(' ')}
        aria-hidden
        data-backend-icon="glyph"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: radius,
          background: 'color-mix(in srgb, currentColor 10%, transparent)',
          flexShrink: 0,
          userSelect: 'none',
          ...props.style,
        }}
      >
        {svg}
      </span>
    );
  }

  return (
    <span
      className={['session-backend-icon', 'is-glyph', props.className].filter(Boolean).join(' ')}
      aria-hidden
      data-backend-icon="glyph"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        userSelect: 'none',
        ...props.style,
      }}
    >
      {svg}
    </span>
  );
}
