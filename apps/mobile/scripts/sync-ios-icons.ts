/** Keep the generated Xcode catalog in sync with the full-size mobile master. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = join(mobileRoot, 'src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset');

if (existsSync(join(catalog, 'Contents.json'))) {
  const temporary = mkdtempSync(join(tmpdir(), 'piwin-ios-icons-'));
  try {
    const generated = spawnSync('pnpm', ['exec', 'tauri', 'icon', 'src-tauri/icons/icon.png',
      '--output', temporary, '--ios-color', '#1b1918'], { cwd: mobileRoot, encoding: 'utf8' });
    if (generated.status !== 0) {
      throw new Error(`iOS icon generation failed: ${generated.error?.message ?? generated.stderr}`);
    }
    const generatedIos = join(temporary, 'ios');
    const filenames = readdirSync(generatedIos).filter((filename) => filename.endsWith('.png'));
    for (const filename of filenames) {
      const output = join(catalog, filename);
      const expected = readFileSync(join(generatedIos, filename));
      // Avoid recompiling the asset catalog on every development launch.
      if (!existsSync(output) || !readFileSync(output).equals(expected)) {
        copyFileSync(join(generatedIos, filename), output);
      }
    }
    console.log(`iOS app icon catalog synchronized (${filenames.length} sizes)`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  console.log('iOS icon catalog is not initialized; run pnpm ios:init to create it.');
}
