import { useMemo, type ReactElement } from 'react';
import { encode } from 'uqr';

export type QrCodeProps = {
  value: string;
  /** Rendered edge length in CSS pixels. */
  size?: number;
  /** Accessible name; a QR is meaningless to a screen reader without one. */
  label: string;
  testId?: string;
};

/** Quiet zone the QR spec requires around the symbol, in modules. */
const QUIET_ZONE_MODULES = 4;

/**
 * Scannable QR code as a single SVG path.
 *
 * Always dark-on-white regardless of theme: many phone scanners fail on
 * inverted codes, so this deliberately ignores the dark palette.
 */
export function QrCode({ value, size = 200, label, testId }: QrCodeProps): ReactElement {
  const { path, extent } = useMemo(() => buildQrPath(value), [value]);
  return (
    <svg
      className="ui-qr-code"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      data-testid={testId}
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

function buildQrPath(value: string): { path: string; extent: number } {
  // M-level recovery tolerates a glare spot on a laptop screen.
  const { data, size } = encode(value, { ecc: 'M', border: 0 });
  const segments: string[] = [];
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        segments.push(`M${x + QUIET_ZONE_MODULES} ${y + QUIET_ZONE_MODULES}h1v1h-1z`);
      }
    });
  });
  return { path: segments.join(''), extent: size + QUIET_ZONE_MODULES * 2 };
}
