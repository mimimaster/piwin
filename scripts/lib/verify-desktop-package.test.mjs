import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import {
  interpretCodesignDump,
  isPlaceholderHostServe,
  packagedAppLayout,
  selectPackagedAppNames,
  selectPackagedDmgNames,
} from './verify-desktop-package.mjs';

test('packagedAppLayout uses the Tauri 2 sidecar + resources host tree', () => {
  const layout = packagedAppLayout('/tmp/piwinwin.app');
  assert.equal(layout.macosBinary, join('/tmp/piwinwin.app', 'Contents/MacOS/piwin-desktop'));
  assert.equal(layout.sidecarNode, join('/tmp/piwinwin.app', 'Contents/MacOS/piwin-host'));
  assert.equal(
    layout.hostServe,
    join('/tmp/piwinwin.app', 'Contents/Resources/host/host-serve.mjs'),
  );
  assert.match(layout.lancedbNative, /lancedb-darwin-arm64/);
});

test('artifact name filters ignore helper files in the dmg folder', () => {
  assert.deepEqual(selectPackagedAppNames(['piwinwin.app', 'Notes.txt']), ['piwinwin.app']);
  assert.deepEqual(selectPackagedDmgNames(['piwinwin_0.0.0_aarch64.dmg', 'bundle_dmg.sh', 'icon.icns']), [
    'piwinwin_0.0.0_aarch64.dmg',
  ]);
});

test('isPlaceholderHostServe matches the Rust packaged-host byte guard', () => {
  assert.equal(isPlaceholderHostServe(65), true);
  assert.equal(isPlaceholderHostServe(200), false);
  assert.equal(isPlaceholderHostServe(17_000_000), false);
});

test('interpretCodesignDump distinguishes ad-hoc from Developer ID', () => {
  const adhoc = interpretCodesignDump(`
Identifier=piwin_desktop-3e76212b87712fb7
CodeDirectory v=20400 size=198328 flags=0x20002(adhoc,linker-signed)
Signature=adhoc
TeamIdentifier=not set
`);
  assert.equal(adhoc.adhoc, true);
  assert.equal(adhoc.developerId, false);

  const signed = interpretCodesignDump(`
Identifier=app.piwinwin.desktop
Authority=Developer ID Application: Example Co. (F47G63A8DM)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
TeamIdentifier=F47G63A8DM
`);
  assert.equal(signed.adhoc, false);
  assert.equal(signed.developerId, true);
  assert.equal(signed.teamId, 'F47G63A8DM');
  assert.equal(signed.identity, 'Developer ID Application: Example Co. (F47G63A8DM)');
});
