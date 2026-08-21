#!/usr/bin/env node
/**
 * Download official Node LTS binary for the packaging triple (ADR 0017 / plan S2).
 * Writes: apps/desktop/src-tauri/binaries/piwin-host-<triple>[.exe]
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, chmod, copyFile, rm, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

// Pin exact LTS (update deliberately; re-run S5 after bumps).
// Pi 0.84 engines require Node >=22.19.0 (see docs/notes/2026-08-19-pi-0.84.2-upgrade.md).
const NODE_VERSION = 'v22.19.0';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const binariesDir = join(root, 'apps/desktop/src-tauri/binaries');
const cacheDir = join(homedir(), '.cache', 'piwin-build', 'node', NODE_VERSION);

function detectTriple() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  throw new Error(`unsupported host triple: ${platform}/${arch}`);
}

function nodeDistName(triple) {
  // Map rust triple → node dist folder name
  const map = {
    'aarch64-apple-darwin': 'darwin-arm64',
    'x86_64-apple-darwin': 'darwin-x64',
    'x86_64-unknown-linux-gnu': 'linux-x64',
    'aarch64-unknown-linux-gnu': 'linux-arm64',
    'x86_64-pc-windows-msvc': 'win-x64',
  };
  const key = map[triple];
  if (!key) throw new Error(`no node dist mapping for ${triple}`);
  const ext = triple.includes('windows') ? 'zip' : 'tar.gz';
  return { key, archive: `node-${NODE_VERSION}-${key}.${ext}`, ext };
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed ${response.status}: ${url}`);
  }
  await mkdir(dirname(dest), { recursive: true });
  await pipeline(response.body, createWriteStream(dest));
}

async function sha256File(path) {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  let triple = detectTriple();
  const targetIdx = args.indexOf('--target');
  if (targetIdx >= 0 && args[targetIdx + 1]) {
    triple = args[targetIdx + 1];
  }

  const { key, archive, ext } = nodeDistName(triple);
  const baseUrl = `https://nodejs.org/dist/${NODE_VERSION}`;
  const archiveUrl = `${baseUrl}/${archive}`;
  const shasumsUrl = `${baseUrl}/SHASUMS256.txt`;

  await mkdir(cacheDir, { recursive: true });
  await mkdir(binariesDir, { recursive: true });

  const archivePath = join(cacheDir, archive);
  try {
    await access(archivePath);
    console.log(`[fetch-node] cache hit ${archivePath}`);
  } catch {
    console.log(`[fetch-node] downloading ${archiveUrl}`);
    await download(archiveUrl, archivePath);
  }

  console.log('[fetch-node] verifying SHA256…');
  const shasumsPath = join(cacheDir, 'SHASUMS256.txt');
  try {
    await access(shasumsPath);
  } catch {
    await download(shasumsUrl, shasumsPath);
  }
  const shasums = await readFile(shasumsPath, 'utf8');
  const expectedLine = shasums.split('\n').find((line) => line.endsWith(archive));
  if (!expectedLine) {
    throw new Error(`SHA sum not found for ${archive}`);
  }
  const expected = expectedLine.split(/\s+/)[0];
  const actual = await sha256File(archivePath);
  if (actual !== expected) {
    throw new Error(`SHA256 mismatch for ${archive}: got ${actual}, expected ${expected}`);
  }
  console.log('[fetch-node] checksum ok');

  const extractDir = join(cacheDir, `extract-${key}`);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });

  if (ext === 'tar.gz') {
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', extractDir], {
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error('tar extract failed');
    }
  } else {
    // Windows zip — use unzip if available
    const result = spawnSync('unzip', ['-q', archivePath, '-d', extractDir], {
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error('unzip failed — install unzip or run on Unix for now');
    }
  }

  const nodeBinName = triple.includes('windows') ? 'node.exe' : 'node';
  const extractedNode = join(extractDir, `node-${NODE_VERSION}-${key}`, triple.includes('windows') ? nodeBinName : 'bin/node');

  const outName = triple.includes('windows')
    ? `piwin-host-${triple}.exe`
    : `piwin-host-${triple}`;
  const outPath = join(binariesDir, outName);
  // Tauri externalBin also wants unprefixed name with triple suffix convention:
  // externalBin: ["binaries/piwin-host"] → looks for piwin-host-<triple>
  await copyFile(extractedNode, outPath);
  if (!triple.includes('windows')) {
    await chmod(outPath, 0o755);
  }

  // Also copy as the generic name used by externalBin lookup during local checks
  const versionCheck = spawnSync(outPath, ['--version'], { encoding: 'utf8' });
  if (versionCheck.status !== 0) {
    throw new Error(`bundled node failed --version: ${versionCheck.stderr}`);
  }
  console.log(`[fetch-node] wrote ${outPath} (${versionCheck.stdout.trim()})`);
}

main().catch((error) => {
  console.error('[fetch-node] failed:', error);
  process.exit(1);
});
