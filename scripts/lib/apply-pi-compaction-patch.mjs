import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const patchDirectory = fileURLToPath(new URL('../../packages/agent-host/patches/', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function runGit(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

/** Apply the exact pnpm patch to the bundler's isolated npm installation. */
export async function applyPiCompactionPatch(packageRoot) {
  const metadata = JSON.parse(await readFile(join(patchDirectory, 'auto-compaction.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== metadata.package || manifest.version !== metadata.version) {
    throw new Error(`Pi compaction patch requires ${metadata.package}@${metadata.version}; got ${manifest.name}@${manifest.version}`);
  }

  // Windows autocrlf may rewrite the vendored patch; normalize to LF before the
  // checksum so Host packaging stays byte-identical to the macOS lane.
  const patchBytes = Buffer.from(
    (await readFile(join(patchDirectory, metadata.patchFile), 'utf8')).replace(/\r\n/g, '\n'),
    'utf8',
  );
  if (digest(patchBytes) !== metadata.patchSha256) {
    throw new Error('Pi compaction patch checksum mismatch');
  }

  const hashes = await Promise.all(metadata.files.map(async (file) => ({
    ...file, actual: digest(await readFile(join(packageRoot, file.path))),
  })));
  const alreadyApplied = hashes.every((file) => file.actual === file.afterSha256);
  if (!alreadyApplied) {
    const mismatch = hashes.find((file) => file.actual !== file.beforeSha256);
    if (mismatch) throw new Error(`Pi compaction preimage mismatch: ${mismatch.path}`);

    // Ambient git repos make `git apply --no-index` skip matching hunks. Apply
    // through an isolated bare GIT_DIR + work-tree instead.
    const scratch = await mkdtemp(join(tmpdir(), 'piwin-pi-patch-'));
    const gitDir = join(scratch, 'git');
    const patchPath = join(scratch, `patch-${randomBytes(4).toString('hex')}.patch`);
    try {
      runGit(['init', '--bare', gitDir]);
      await writeFile(patchPath, patchBytes);
      for (const check of [true, false]) {
        runGit(
          [
            `--git-dir=${gitDir}`,
            `--work-tree=${packageRoot}`,
            'apply',
            '-p1',
            ...(check ? ['--check'] : []),
            patchPath,
          ],
          { cwd: packageRoot },
        );
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
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
