import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { checkIosRuntime } from './lib/ios-runtime-policy.mjs';
import { checkIosSceneConfiguration } from './lib/ios-scene-policy.mjs';

const appPath = resolve(process.argv[2] ?? 'apps/mobile/src-tauri/gen/apple/build/piwin-mobile_iOS.xcarchive/Products/Applications/piwin shell.app');
function readTool(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed to inspect the native app.`);
  return result.stdout.trim();
}
const plist = join(appPath, 'Info.plist');
const minimumOsVersion = readTool('plutil', ['-extract', 'MinimumOSVersion', 'raw', '-o', '-', plist]);
const executable = readTool('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist]);
const failures = checkIosRuntime({
  minimumOsVersion,
  linkedLibraries: readTool('otool', ['-L', join(appPath, executable)]),
  bundledConcurrency: existsSync(join(appPath, 'Frameworks/libswift_Concurrency.dylib')),
});
const sceneResult = spawnSync('plutil', ['-extract', 'UIApplicationSceneManifest', 'json', '-o', '-', plist], { encoding: 'utf8' });
if (sceneResult.error || sceneResult.status !== 0) {
  failures.push('The application must declare an iOS scene manifest.');
} else {
  failures.push(...checkIosSceneConfiguration(JSON.parse(sceneResult.stdout)));
}
if (failures.length) throw new Error(failures.join('\n'));
console.log('iOS runtime and scene packaging OK');
