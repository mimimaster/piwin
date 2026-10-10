import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatReleaseVersion,
  installerFileNames,
  latestReleaseVersion,
  nextReleaseVersion,
  parseReleaseVersion,
  releaseKind,
} from './release-version.mjs';

test('parseReleaseVersion accepts plain X.Y.Z tags only', () => {
  assert.deepEqual(parseReleaseVersion('v0.1.0'), { major: 0, minor: 1, patch: 0 });
  assert.deepEqual(parseReleaseVersion('1.12.3'), { major: 1, minor: 12, patch: 3 });
  assert.equal(parseReleaseVersion('1.0-preview'), undefined);
  assert.equal(parseReleaseVersion('v0.1.0-rc.1'), undefined);
});

test('latestReleaseVersion compares numerically and skips non-release tags', () => {
  const latest = latestReleaseVersion(['1.0-preview', 'v0.1.0', 'v0.1.10', 'v0.1.9', '']);
  assert.equal(latest && formatReleaseVersion(latest), '0.1.10');
  assert.equal(latestReleaseVersion(['1.0-preview']), undefined);
});

test('nextReleaseVersion: small update bumps patch, formal release bumps minor', () => {
  const latest = parseReleaseVersion('v0.1.4');
  assert.equal(formatReleaseVersion(nextReleaseVersion(latest, 'patch')), '0.1.5');
  assert.equal(formatReleaseVersion(nextReleaseVersion(latest, 'formal')), '0.2.0');
  assert.equal(formatReleaseVersion(nextReleaseVersion(undefined, 'patch')), '0.0.1');
});

test('releaseKind derives from the version alone', () => {
  assert.equal(releaseKind({ major: 0, minor: 2, patch: 0 }), 'formal');
  assert.equal(releaseKind({ major: 0, minor: 2, patch: 1 }), 'patch');
});

test('installerFileNames maps Tauri output to public names', () => {
  assert.deepEqual(installerFileNames('0.1.1'), {
    macos: { built: 'piwin_0.1.1_aarch64.dmg', published: 'piwinwin_0.1.1_aarch64.dmg' },
    windows: { built: 'piwin_0.1.1_x64-setup.exe', published: 'piwinwin_0.1.1_x64-setup.exe' },
  });
});
