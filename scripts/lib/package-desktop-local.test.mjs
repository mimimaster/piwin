import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalDesktopDmgFileName,
  classifyDesktopPackageFailure,
  leftoverPiwinDmgImagePaths,
  leftoverRwDmgFileNames,
  newestAppPath,
  parseDfAvailBytes,
  pickPackageTempDir,
} from './package-desktop-local.mjs';

test('leftoverPiwinDmgImagePaths picks rw temp images and ignores other volumes', () => {
  const info = `
image-path      : /Volumes/BigDisk/scratch.dmg
image-path      : /Users/me/src-tauri/target/release/bundle/macos/rw.85830.piwinwin_0.0.0_aarch64.dmg
image-path      : /Users/me/src-tauri/target/release/bundle/dmg/piwinwin_0.0.0_aarch64.dmg
image-path      : /tmp/other.dmg
`;
  assert.deepEqual(leftoverPiwinDmgImagePaths(info), [
    '/Users/me/src-tauri/target/release/bundle/macos/rw.85830.piwinwin_0.0.0_aarch64.dmg',
  ]);
});

test('leftoverRwDmgFileNames ignores the finished installer', () => {
  assert.deepEqual(
    leftoverRwDmgFileNames(['piwinwin.app', 'rw.94490.piwinwin_0.0.0_aarch64.dmg', 'Notes.txt']),
    ['rw.94490.piwinwin_0.0.0_aarch64.dmg'],
  );
});

test('classifyDesktopPackageFailure maps timestamp vs bundle_dmg vs other', () => {
  assert.equal(
    classifyDesktopPackageFailure('The timestamp service is not available.\nfailed to sign app'),
    'codesign',
  );
  assert.equal(
    classifyDesktopPackageFailure('failed to bundle project: error running bundle_dmg.sh'),
    'bundle-dmg',
  );
  assert.equal(classifyDesktopPackageFailure('error TS2304: Cannot find name'), 'other');
});

test('pickPackageTempDir prefers env, then a roomy extra volume on Darwin', () => {
  assert.equal(
    pickPackageTempDir({
      envTmpdir: ' /extra/tmp ',
      platform: 'darwin',
      systemAvailBytes: 1024,
      extraTmpdir: '/Volumes/BigDisk/tmp',
      osTmpdir: '/var/folders/xx',
    }),
    '/extra/tmp',
  );
  assert.equal(
    pickPackageTempDir({
      platform: 'darwin',
      systemAvailBytes: 2 * 1024 * 1024 * 1024,
      extraTmpdir: '/Volumes/BigDisk/tmp',
      osTmpdir: '/var/folders/xx',
    }),
    '/Volumes/BigDisk/tmp',
  );
  assert.equal(
    pickPackageTempDir({
      platform: 'darwin',
      systemAvailBytes: 20 * 1024 * 1024 * 1024,
      extraTmpdir: '/Volumes/BigDisk/tmp',
      osTmpdir: '/var/folders/xx',
    }),
    '/var/folders/xx',
  );
});

test('parseDfAvailBytes reads the POSIX Available column', () => {
  const df = `Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk3s5  239075328 138000000  61000000    70% /
`;
  assert.equal(parseDfAvailBytes(df), 61000000 * 1024);
});

test('canonicalDesktopDmgFileName maps arm64 to aarch64', () => {
  assert.equal(canonicalDesktopDmgFileName('0.0.0', 'arm64'), 'piwin_0.0.0_aarch64.dmg');
  assert.equal(canonicalDesktopDmgFileName('0.1.0', 'x64'), 'piwin_0.1.0_x64.dmg');
});

test('newestAppPath returns the latest mtime', () => {
  assert.equal(
    newestAppPath([
      { path: '/old/piwinwin.app', mtimeMs: 1 },
      { path: '/new/piwinwin.app', mtimeMs: 9 },
    ]),
    '/new/piwinwin.app',
  );
  assert.equal(newestAppPath([]), undefined);
});
