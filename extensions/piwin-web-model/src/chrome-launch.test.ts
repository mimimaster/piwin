/**
 * Chrome discovery matrix.
 *
 * The executable lookup is injected so this test does not depend on which
 * browsers the machine running it happens to have.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveChromeExecutable } from './chrome-launch.ts';

const never = () => false;

test('picks the first existing candidate in order', () => {
  const found = resolveChromeExecutable(
    'darwin',
    (path) => path.includes('Google Chrome.app'),
    {},
  );
  assert.match(found, /Google Chrome\.app\/Contents\/MacOS\/Google Chrome$/);
});

test('falls through to a later candidate when the first is missing', () => {
  const found = resolveChromeExecutable('linux', (path) => path === '/usr/bin/chromium', {});
  assert.equal(found, '/usr/bin/chromium');
});

test('an explicit override wins when it exists', () => {
  const found = resolveChromeExecutable('darwin', () => true, {
    PIWIN_WEB_MODEL_CHROME_PATH: '/opt/custom/chrome',
  });
  assert.equal(found, '/opt/custom/chrome');
});

test('a broken override fails loudly instead of silently falling back', () => {
  assert.throws(
    () => resolveChromeExecutable('darwin', () => false, { PIWIN_WEB_MODEL_CHROME_PATH: '/nope/chrome' }),
    /PIWIN_WEB_MODEL_CHROME_PATH does not exist/,
  );
});

test('no browser at all reports what was tried', () => {
  assert.throws(() => resolveChromeExecutable('darwin', never, {}), /Tried: \/Applications\/Google Chrome\.app/);
});
