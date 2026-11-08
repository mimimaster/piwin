import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const patchDirectory = fileURLToPath(new URL('../../packages/agent-host/patches/', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Apply the exact pnpm patch to the bundler's isolated npm installation. */
export async function applyPiCompactionPatch(packageRoot) {
  const metadata = JSON.parse(await readFile(join(patchDirectory, 'auto-compaction.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== metadata.package || manifest.version !== metadata.version) {
    throw new Error(`Pi compaction patch requires ${metadata.package}@${metadata.version}; got ${manifest.name}@${manifest.version}`);
  }
  const patchPath = join(patchDirectory, metadata.patchFile);
  if (digest(await readFile(patchPath)) !== metadata.patchSha256) {
    throw new Error('Pi compaction patch checksum mismatch');
  }
  const hashes = await Promise.all(metadata.files.map(async (file) => ({
    ...file, actual: digest(await readFile(join(packageRoot, file.path))),
  })));
  const alreadyApplied = hashes.every((file) => file.actual === file.afterSha256);
  if (!alreadyApplied) {
    const mismatch = hashes.find((file) => file.actual !== file.beforeSha256);
    if (mismatch) throw new Error(`Pi compaction preimage mismatch: ${mismatch.path}`);
    // git apply has no fuzzy matching; the hashes above also reject partial or
    // unrelated modifications before any package file is touched.
    for (const check of [true, false]) {
      const result = spawnSync('git', [
        'apply', '--no-index', '--unsafe-paths', `--directory=${packageRoot}`,
        ...(check ? ['--check'] : []), patchPath,
      ], { cwd: dirname(packageRoot), encoding: 'utf8' });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Pi compaction patch failed: ${result.stderr}`);
    }
  }
  for (const file of metadata.files) {
    if (digest(await readFile(join(packageRoot, file.path))) !== file.afterSha256) {
      throw new Error(`Pi compaction postimage mismatch: ${file.path}`);
    }
  }
  await writeFile(
    join(packageRoot, 'PIWIN-AUTO-COMPACTION-NOTICE.txt'),
    `Pi automatic compaction backports: v0.84.4 (#6879), v0.86.0 (#9740).\nLocal zero-usage/stale-baseline and cancellation guards.\n\n${await readFile(join(patchDirectory, 'LICENSE'), 'utf8')}`,
  );
  return { alreadyApplied };
}
