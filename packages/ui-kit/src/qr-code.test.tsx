// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { encode } from 'uqr';
import { QrCode } from './qr-code.js';

describe('QrCode', () => {
  it('renders the encoded matrix with a 4-module quiet zone', () => {
    const value = 'piwin://pair?endpoint=ws%3A%2F%2F192.168.1.5%3A8787&pairingToken=abc';
    const { size, data } = encode(value, { ecc: 'M', border: 0 });
    const markup = renderToString(<QrCode value={value} label="Pairing QR" size={180} testId="qr" />);
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Pairing QR"');
    expect(markup).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
    const darkModules = data.flat().filter(Boolean).length;
    expect(markup.match(/h1v1h-1z/g)).toHaveLength(darkModules);
    // Top-left finder pattern starts right after the quiet zone.
    expect(markup).toContain('M4 4h1v1h-1z');
  });
});
