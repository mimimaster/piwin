import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  macGateFailures,
  windowsBuildScript,
  windowsInstallerScpPath,
} from './release-build-commands.mjs';
import { resolveReleaseConfig } from './release-config.mjs';

const COMMIT = '6d364fa6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

test('windowsBuildScript pins the exact commit and applies the version before building', () => {
  const script = windowsBuildScript({ dir: 'D:\\Codes\\piwin', commit: COMMIT, version: '0.1.1' });
  const order = [
    "Set-Location -LiteralPath 'D:\\Codes\\piwin'",
    `git reset --hard ${COMMIT}`,
    `if ($head -ne '${COMMIT}')`,
    'pnpm install --frozen-lockfile --ignore-scripts',
    'node scripts/apply-desktop-version.mjs 0.1.1',
    'pnpm bundle:host',
    'pnpm --dir apps/desktop package',
    '[release-win] HEAD=$head',
  ].map((needle) => script.indexOf(needle));
  assert.ok(
    order.every((index) => index >= 0),
    script,
  );
  assert.deepEqual(
    order,
    [...order].sort((left, right) => left - right),
  );
  assert.ok(!script.includes('origin/main'));
  // Windows PowerShell 5.1 reads -File scripts line by line; keep CRLF endings.
  assert.ok(script.endsWith('\r\n') && !/[^\r]\n/.test(script));
});

test('windowsInstallerScpPath uses forward slashes', () => {
  assert.equal(
    windowsInstallerScpPath('D:\\Codes\\piwin\\', 'piwin_0.1.1_x64-setup.exe'),
    'D:/Codes/piwin/apps/desktop/src-tauri/target/release/bundle/nsis/piwin_0.1.1_x64-setup.exe',
  );
});

test('macGateFailures passes only a notarized Developer ID DMG', () => {
  const codesign =
    'Authority=Developer ID Application: Example Co., Ltd. (ABCDE12345)\nTeamIdentifier=ABCDE12345';
  assert.deepEqual(
    macGateFailures({
      codesign,
      staplerOk: true,
      spctl:
        'x.dmg: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: Example',
    }),
    [],
  );
  assert.deepEqual(
    macGateFailures({
      codesign,
      staplerOk: false,
      spctl: 'x.dmg: accepted\nsource=Unnotarized Developer ID',
    }),
    ['stapler validate failed', 'spctl: source is not "Notarized Developer ID"'],
  );
  assert.equal(
    macGateFailures({ codesign: 'Signature=adhoc', staplerOk: false, spctl: 'x.dmg: rejected' })
      .length,
    4,
  );
});

test('resolveReleaseConfig keeps machine facts optional and public facts defaulted', () => {
  const bare = resolveReleaseConfig(undefined, { repoRoot: '/src/piwin' });
  assert.equal(bare.macCheckout, '/src/piwin-release');
  assert.equal(bare.apple, undefined);
  assert.equal(bare.windows, undefined);
  assert.deepEqual(bare.r2, {
    bucket: 'piwin-downloads',
    publicBase: 'https://dl.piwinwin.com',
    rcloneRemote: undefined,
  });
  const full = resolveReleaseConfig(
    {
      macCheckout: ' /big/piwin-release ',
      windows: { ssh: 'me@box', dir: 'D:\\x' },
      apple: { apiKey: 'K' },
    },
    { repoRoot: '/src/piwin' },
  );
  assert.equal(full.macCheckout, '/big/piwin-release');
  assert.deepEqual(full.windows, { ssh: 'me@box', dir: 'D:\\x' });
  // Half an Apple credential is no credential.
  assert.equal(full.apple, undefined);
});
