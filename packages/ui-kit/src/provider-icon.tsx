/**
 * Provider brand icons via `modelicons` (official AI brand SVGs).
 * Known vendors → Avatar chip; unknown/custom → monogram from display name,
 * or a neutral model mark when the icon stands for a model (`fallback="model"`).
 *
 * Brand SVGs load once on first mount so the cold main chunk stays smaller.
 */

import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { ModelFallbackIcon } from './model-fallback-icon.js';
import {
  areProviderBrandIconsReady,
  loadProviderBrandIcons,
  resolveBrand,
} from './provider-brands.js';

export type ProviderIconProps = {
  /** Preset id or provider config id. */
  id: string;
  /** Display name — used for monogram when no brand mark matches. */
  name?: string;
  /** Model ID for fallback brand detection when provider ID is custom (e.g. OpenAI proxy / custom gateway). */
  modelId?: string;
  size?: number;
  radius?: number | string;
  /** `avatar` (default) is the brand chip; `glyph` is the bare mark with no
   *  tile, for quiet bylines where a filled disc would out-shout the text. */
  variant?: 'avatar' | 'glyph';
  /** What to draw when no brand matches: the name's `monogram` (default, for
   *  providers) or a neutral `model` mark (for model rows / bylines). */
  fallback?: 'monogram' | 'model';
  className?: string;
  style?: CSSProperties;
};

/** Soft pastel pairs for monogram avatars (unknown / custom providers). */
const MONO_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#e8eefc', fg: '#3b5bdb' },
  { bg: '#e9f7ef', fg: '#0f9d63' },
  { bg: '#fdecec', fg: '#d64545' },
  { bg: '#fdf1dd', fg: '#b06a00' },
  { bg: '#eee9fe', fg: '#6a4df4' },
  { bg: '#e6f0fa', fg: '#2f6fb2' },
  { bg: '#f8ece4', fg: '#c9603f' },
  { bg: '#e9edf2', fg: '#334155' },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function monogramFromName(
  name: string | undefined,
  id: string,
): { bg: string; fg: string; mono: string } {
  const source = (name?.trim() || id).trim();
  const letterMatch = source.match(/[\p{L}\p{N}]/u);
  const mono = (letterMatch?.[0] ?? '?').toUpperCase();
  const palette = MONO_PALETTE[hashString(source.toLowerCase()) % MONO_PALETTE.length] ?? {
    bg: '#edf1f6',
    fg: '#64748b',
  };
  return { bg: palette.bg, fg: palette.fg, mono };
}

/** Soft pastel tile with real brand SVG (or monogram / model-mark fallback). */
export function ProviderIcon(props: ProviderIconProps): ReactElement {
  const [, setIconsReady] = useState(() => areProviderBrandIconsReady());
  useEffect(() => {
    if (areProviderBrandIconsReady()) return undefined;
    let cancelled = false;
    void loadProviderBrandIcons().then(() => {
      if (!cancelled) setIconsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const size = props.size ?? 28;
  const brand = resolveBrand(props.id, props.modelId);
  const radius = props.radius ?? Math.max(8, Math.round(size * 0.29));
  const className = ['provider-icon', props.className].filter(Boolean).join(' ');

  if (!brand && props.fallback === 'model') {
    const fallbackProps = {
      size,
      radius,
      providerId: props.id,
      ...(props.variant ? { variant: props.variant } : {}),
      ...(props.className ? { className: props.className } : {}),
      ...(props.style ? { style: props.style } : {}),
    };
    return <ModelFallbackIcon {...fallbackProps} />;
  }

  if (props.variant === 'glyph') {
    const Glyph = brand ? (brand.Icon.Color ?? brand.Icon) : null;
    return (
      <span
        className={`${className} is-glyph`}
        aria-hidden
        data-provider-icon={props.id}
        data-provider-brand={brand ? (brand.Icon.title ?? 'brand') : 'mono'}
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
        {Glyph ? (
          <Glyph size={size} style={{ display: 'block' }} />
        ) : (
          <span style={{ fontSize: Math.round(size * 0.78), fontWeight: 600, lineHeight: 1 }}>
            {monogramFromName(props.name, props.id).mono}
          </span>
        )}
      </span>
    );
  }

  // Prefer modelicons Avatar (official brand chip).
  if (brand?.Icon.Avatar) {
    const Avatar = brand.Icon.Avatar;
    return (
      <span
        className={className}
        aria-hidden
        data-provider-icon={props.id}
        data-provider-brand={brand.Icon.title ?? 'brand'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: radius,
          overflow: 'hidden',
          flexShrink: 0,
          userSelect: 'none',
          ...props.style,
        }}
      >
        <Avatar
          size={size}
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            display: 'block',
          }}
        />
      </span>
    );
  }

  // Mono glyph on soft pastel when Avatar is missing.
  if (brand) {
    const Icon = brand.Icon;
    const glyph = Math.round(size * 0.58);
    return (
      <span
        className={className}
        aria-hidden
        data-provider-icon={props.id}
        data-provider-brand={brand.Icon.title ?? 'brand'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: radius,
          background: brand.softBg,
          color: brand.softFg,
          flexShrink: 0,
          userSelect: 'none',
          ...props.style,
        }}
      >
        <Icon size={glyph} style={{ display: 'block', color: brand.softFg }} />
      </span>
    );
  }

  // Custom / unknown → monogram from display name.
  const mono = monogramFromName(props.name, props.id);
  const monoSize = Math.round(size * 0.4);
  return (
    <span
      className={className}
      aria-hidden
      data-provider-icon={props.id}
      data-provider-brand="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: radius,
        background: mono.bg,
        color: mono.fg,
        flexShrink: 0,
        userSelect: 'none',
        ...props.style,
      }}
    >
      <span
        style={{
          fontSize: monoSize,
          fontWeight: 700,
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}
      >
        {mono.mono}
      </span>
    </span>
  );
}
