import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  interpretCodesignDump,
  isPlaceholderHostServe,
  packagedAppLayout,
  resolvePackagedVerifyTarget,
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

test('resolvePackagedVerifyTarget attaches the DMG when Tauri removed the .app', () => {
  assert.deepEqual(
    resolvePackagedVerifyTarget([], ['piwinwin_0.0.0_aarch64.dmg']),
    { kind: 'dmg', dmgName: 'piwinwin_0.0.0_aarch64.dmg' },
  );
  assert.deepEqual(
    resolvePackagedVerifyTarget(['piwinwin.app'], ['piwinwin_0.0.0_aarch64.dmg']),
    { kind: 'app', appName: 'piwinwin.app', dmgName: 'piwinwin_0.0.0_aarch64.dmg' },
  );
  assert.deepEqual(resolvePackagedVerifyTarget(['piwinwin.app'], []), { kind: 'missing-dmg' });
  assert.deepEqual(resolvePackagedVerifyTarget([], []), { kind: 'missing-dmg' });
  assert.deepEqual(resolvePackagedVerifyTarget(['a.app', 'b.app'], ['x.dmg']), {
    kind: 'ambiguous-app',
    appNames: ['a.app', 'b.app'],
  });
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

test(
  'verify-desktop-package inspects the nested .app when macos/*.app was deleted',
  { skip: process.platform !== 'darwin' },
  () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const scratch = mkdtempSync(join(tmpdir(), 'piwin-verify-dmg-'));
    try {
      const app = join(scratch, 'src', 'piwinwin.app');
      const host = join(app, 'Contents', 'Resources', 'host');
      mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
      mkdirSync(join(host, 'bundled-assets'), { recursive: true });
      mkdirSync(join(host, 'node_modules', '@lancedb', 'lancedb-darwin-arm64'), { recursive: true });
      writeFileSync(
        join(app, 'Contents', 'Info.plist'),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>piwin-desktop</string>
  <key>CFBundleIdentifier</key>
  <string>app.piwinwin.desktop</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
`,
      );
      writeFileSync(join(scratch, 'tiny.c'), '#include <stdio.h>\nint main(void){return 0;}\n');
      const cc = spawnSync('cc', ['-o', join(app, 'Contents', 'MacOS', 'piwin-desktop'), join(scratch, 'tiny.c')], {
        encoding: 'utf8',
      });
      assert.equal(cc.status, 0, cc.stderr);
      copyFileSync(join(app, 'Contents', 'MacOS', 'piwin-desktop'), join(app, 'Contents', 'MacOS', 'piwin-host'));
      writeFileSync(join(host, 'host-serve.mjs'), `${'x'.repeat(250)}\n`);
      writeFileSync(join(host, 'agent-worker.mjs'), 'worker\n');
      writeFileSync(join(host, 'package.json'), '{}\n');
      writeFileSync(
        join(host, 'node_modules', '@lancedb', 'lancedb-darwin-arm64', 'lancedb.darwin-arm64.node'),
        'native\n',
      );
      const dmgPath = join(scratch, 'piwinwin_0.0.0_aarch64.dmg');
      const create = spawnSync(
        'hdiutil',
        ['create', '-volname', 'piwinwin', '-srcfolder', join(scratch, 'src'), '-ov', '-format', 'UDZO', dmgPath],
        { encoding: 'utf8' },
      );
      assert.equal(create.status, 0, create.stderr);
      const cargo = join(scratch, 'cargo');
      mkdirSync(join(cargo, 'release', 'bundle', 'macos'), { recursive: true });
      mkdirSync(join(cargo, 'release', 'bundle', 'dmg'), { recursive: true });
      copyFileSync(dmgPath, join(cargo, 'release', 'bundle', 'dmg', 'piwinwin_0.0.0_aarch64.dmg'));
      const verify = spawnSync('node', [join(root, 'scripts', 'verify-desktop-package.mjs')], {
        encoding: 'utf8',
        env: { ...process.env, CARGO_TARGET_DIR: cargo },
      });
      assert.equal(verify.status, 0, `${verify.stdout}\n${verify.stderr}`);
      assert.match(verify.stdout, /\.app missing after DMG bundle/);
      assert.match(verify.stdout, /\[verify-desktop-package\] ok/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  },
);
