/**
 * Copy the tracked launch screen into the generated Xcode project.
 * gen/apple is local build output (gitignored), so `tauri ios init` would
 * otherwise leave the default white LaunchScreen in place.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(mobileRoot, 'src-tauri/ios/launch');
const project = join(mobileRoot, 'src-tauri/gen/apple');

const FILES: ReadonlyArray<[from: string, to: string]> = [
  ['LaunchScreen.storyboard', 'LaunchScreen.storyboard'],
  ['LaunchBackground.colorset/Contents.json', 'Assets.xcassets/LaunchBackground.colorset/Contents.json'],
];

if (existsSync(join(project, 'Assets.xcassets'))) {
  let changed = 0;
  for (const [from, to] of FILES) {
    const input = join(source, from);
    const output = join(project, to);
    // Skip unchanged files so Xcode does not rebuild resources on every launch.
    if (existsSync(output) && readFileSync(output).equals(readFileSync(input))) {
      continue;
    }
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(input, output);
    changed += 1;
  }
  console.log(`iOS launch screen synchronized (${changed} file(s) updated)`);
} else {
  console.log('iOS project is not initialized; run pnpm ios:init to create it.');
}
