import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildUpdaterManifest,
  configuredUpdaterPublicKey,
  macUpdaterBundleFileName,
  renderUpdaterNotes,
  updaterManifestKey,
  updaterPlatformKey,
  updaterPublicKeysMatch,
} from './release-updater-manifest.mjs';

test('maps release platforms to Tauri target-arch keys', () => {
  assert.equal(updaterPlatformKey('macos-aarch64'), 'darwin-aarch64');
  assert.equal(updaterPlatformKey('windows-x64'), 'windows-x86_64');
  assert.throws(() => updaterPlatformKey('linux-x64'));
  assert.equal(updaterManifestKey('darwin-aarch64'), 'updater/darwin-aarch64.json');
});

test('names the macOS updater bundle after the public installer name', () => {
  assert.equal(macUpdaterBundleFileName('0.2.6'), 'piwinwin_0.2.6_aarch64.app.tar.gz');
});

test('renders grouped notes as plain text and drops empty groups', () => {
  assert.equal(
    renderUpdaterNotes([
      { title: '新增', items: ['a', 'b'] },
      { title: '修复', items: [] },
      { title: '', items: ['c'] },
    ]),
    '新增\n- a\n- b\n\n- c',
  );
});

test('builds a single-platform Tauri static manifest with a trimmed signature', () => {
  assert.deepEqual(
    buildUpdaterManifest({
      version: '0.2.6',
      notes: 'n',
      pubDate: '2026-10-21T00:00:00.000Z',
      updaterPlatform: 'darwin-aarch64',
      url: 'https://dl/x.app.tar.gz',
      signature: 'sig\n',
    }),
    {
      version: '0.2.6',
      notes: 'n',
      pub_date: '2026-10-21T00:00:00.000Z',
      platforms: { 'darwin-aarch64': { url: 'https://dl/x.app.tar.gz', signature: 'sig' } },
    },
  );
});

test('compares the configured public key with the key file', () => {
  const conf = { plugins: { updater: { pubkey: ' KEY ' } } };
  assert.equal(configuredUpdaterPublicKey(conf), 'KEY');
  assert.equal(configuredUpdaterPublicKey({}), undefined);
  assert.equal(updaterPublicKeysMatch('KEY', 'KEY\n'), true);
  assert.equal(updaterPublicKeysMatch('KEY', 'OTHER'), false);
  assert.equal(updaterPublicKeysMatch(undefined, 'KEY'), false);
});
