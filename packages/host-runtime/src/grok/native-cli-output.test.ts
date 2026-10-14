import { expect, it } from 'vitest';
import { NativeCliOutputBuffer } from './native-cli-output.js';
it('retains bounded reconnect output without splitting Unicode surrogate pairs', () => {
  const output = new NativeCliOutputBuffer(4);
  output.append('old'); output.append('new');
  expect(output.read().join('')).toBe('new');
  output.append('abcdef😀');
  expect(output.read().join('')).toBe('ef😀');
});
