import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeDesktopPackageVersion,
  replaceDesktopConfigVersion,
} from './desktop-package-version.mjs';

test('normalizeDesktopPackageVersion strips a leading v and rejects junk', () => {
  assert.equal(normalizeDesktopPackageVersion('v0.1.0'), '0.1.0');
  assert.equal(normalizeDesktopPackageVersion(' 1.2.3-beta.1 '), '1.2.3-beta.1');
  assert.throws(() => normalizeDesktopPackageVersion('v1'), /invalid desktop package version/);
  assert.throws(() => normalizeDesktopPackageVersion(''), /invalid desktop package version/);
});

test('replaceDesktopConfigVersion rewrites only the first version field', () => {
  const source = `{
  "productName": "piwinwin",
  "version": "0.0.0",
  "identifier": "app.piwinwin.desktop"
}
`;
  assert.match(replaceDesktopConfigVersion(source, '0.1.0'), /"version": "0.1.0"/);
  assert.throws(() => replaceDesktopConfigVersion('{}', '0.1.0'), /missing a version field/);
});
