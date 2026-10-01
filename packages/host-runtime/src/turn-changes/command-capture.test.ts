import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTurnChangeObjectStore, type TurnChangeObjectStore } from '@piwin/git';
import {
  captureWorkspaceFingerprint,
  diffWorkspaceFingerprints,
  resetWorkspaceFingerprintCooldownsForTests,
} from '../tools/workspace-fingerprint.js';
import { createCommandChangeCapturer, type CommandChangeCapturer } from './command-capture.js';

const text = new TextDecoder();

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

async function bytesOf(store: TurnChangeObjectStore, sha: string | null): Promise<string | null> {
  return sha === null ? null : text.decode(await store.get(sha));
}

describe('command change capture', () => {
  let root: string;
  let storeDir: string;
  let store: TurnChangeObjectStore;
  let capturer: CommandChangeCapturer;

  beforeEach(async () => {
    resetWorkspaceFingerprintCooldownsForTests();
    root = await mkdtemp(join(tmpdir(), 'piwin-cmd-capture-'));
    storeDir = await mkdtemp(join(tmpdir(), 'piwin-cmd-store-'));
    store = createTurnChangeObjectStore({ rootDir: storeDir });
    capturer = createCommandChangeCapturer({ store });
    git(root, 'init', '-q');
    await writeFile(join(root, 'clean.txt'), 'clean original\n');
    await writeFile(join(root, 'wip.txt'), 'committed\n');
    await writeFile(join(root, 'gone.txt'), 'will be deleted\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(storeDir, { recursive: true, force: true });
  });

  /** Run `command` between two fingerprints the way runHostShell does. */
  async function runCommand(
    command: () => Promise<void>,
    capture: CommandChangeCapturer = capturer,
  ) {
    const fingerprint = await captureWorkspaceFingerprint(root);
    if (!fingerprint) throw new Error('expected a git work tree');
    const before = await capture.snapshotBefore({ root, fingerprint });
    await command();
    const after = await captureWorkspaceFingerprint(root);
    if (!after) throw new Error('expected a git work tree');
    return capture.captureChanges({
      root,
      changedPaths: diffWorkspaceFingerprints(fingerprint, after),
      before,
    });
  }

  it('takes the before image of a clean file from HEAD', async () => {
    const captured = await runCommand(async () => {
      await writeFile(join(root, 'clean.txt'), 'edited by a command\n');
    });
    expect(captured.uncaptured).toEqual([]);
    const [receipt] = captured.receipts;
    expect(receipt).toMatchObject({ relativePath: 'clean.txt', beforeExists: true, afterExists: true });
    expect(await bytesOf(store, receipt?.beforeSha ?? null)).toBe('clean original\n');
    expect(await bytesOf(store, receipt?.afterSha ?? null)).toBe('edited by a command\n');
  });

  it('takes the before image of an already-dirty file from the pre-command snapshot', async () => {
    await writeFile(join(root, 'wip.txt'), 'work in progress\n');
    const captured = await runCommand(async () => {
      await writeFile(join(root, 'wip.txt'), 'work in progress, then the command\n');
    });
    const [receipt] = captured.receipts;
    // The WIP the user had, not what HEAD holds.
    expect(await bytesOf(store, receipt?.beforeSha ?? null)).toBe('work in progress\n');
    expect(await bytesOf(store, receipt?.afterSha ?? null)).toBe('work in progress, then the command\n');
  });

  it('records a created file as absent before and a deleted file as absent after', async () => {
    const captured = await runCommand(async () => {
      await writeFile(join(root, 'made.txt'), 'brand new\n');
      await unlink(join(root, 'gone.txt'));
    });
    const byPath = new Map(captured.receipts.map((receipt) => [receipt.relativePath, receipt]));
    expect(byPath.get('made.txt')).toMatchObject({
      beforeExists: false,
      beforeSha: null,
      afterExists: true,
    });
    const gone = byPath.get('gone.txt');
    expect(gone).toMatchObject({ beforeExists: true, afterExists: false, afterSha: null });
    expect(await bytesOf(store, gone?.beforeSha ?? null)).toBe('will be deleted\n');
  });

  it('drops a file whose bytes ended up unchanged', async () => {
    const captured = await runCommand(async () => {
      const later = new Date(Date.now() + 5_000);
      await utimes(join(root, 'clean.txt'), later, later);
      await writeFile(join(root, 'wip.txt'), 'committed\n');
    });
    expect(captured).toEqual({ receipts: [], uncaptured: [] });
  });

  it('chains two commands on one file: the second before image is the first after image', async () => {
    const first = await runCommand(async () => {
      await writeFile(join(root, 'clean.txt'), 'first\n');
    });
    const second = await runCommand(async () => {
      await writeFile(join(root, 'clean.txt'), 'second\n');
    });
    expect(second.receipts[0]?.beforeSha).toBe(first.receipts[0]?.afterSha);
    expect(second.receipts[0]?.beforeExists).toBe(true);
  });

  it('does not trust HEAD for a file a content filter may rewrite', async () => {
    await writeFile(join(root, '.gitattributes'), '*.bin eol=crlf\n');
    await writeFile(join(root, 'filtered.bin'), 'a\nb\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'filtered');
    const captured = await runCommand(async () => {
      await writeFile(join(root, 'filtered.bin'), 'changed\n');
    });
    expect(captured.receipts).toEqual([]);
    expect(captured.uncaptured).toEqual(['filtered.bin']);
  });

  it('leaves a symlink uncaptured', async () => {
    await symlink('clean.txt', join(root, 'link.txt'));
    const captured = await runCommand(async () => {
      await unlink(join(root, 'link.txt'));
      await symlink('wip.txt', join(root, 'link.txt'));
    });
    expect(captured.receipts).toEqual([]);
    expect(captured.uncaptured).toEqual(['link.txt']);
  });

  it('leaves a path uncaptured when it was dirty but never snapshotted', async () => {
    await writeFile(join(root, 'wip.txt'), 'work in progress\n');
    const limited = createCommandChangeCapturer({ store, limits: { maxSnapshotPaths: 0 } });
    const captured = await runCommand(async () => {
      await writeFile(join(root, 'wip.txt'), 'command\n');
    }, limited);
    expect(captured.receipts).toEqual([]);
    expect(captured.uncaptured).toEqual(['wip.txt']);
  });

  it('records at most the cap and reports the rest by path', async () => {
    const limited = createCommandChangeCapturer({ store, limits: { maxCapturedPaths: 2 } });
    const captured = await runCommand(async () => {
      for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
        await writeFile(join(root, name), `${name}\n`);
      }
    }, limited);
    expect(captured.receipts.map((receipt) => receipt.relativePath)).toEqual(['a.txt', 'b.txt']);
    expect(captured.uncaptured).toEqual(['c.txt', 'd.txt']);
  });

  it('works from a subdirectory session root', async () => {
    await mkdir(join(root, 'pkg'));
    await writeFile(join(root, 'pkg', 'inner.txt'), 'inner\n');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'pkg');
    const session = join(root, 'pkg');
    const fingerprint = await captureWorkspaceFingerprint(session);
    if (!fingerprint) throw new Error('expected a git work tree');
    const before = await capturer.snapshotBefore({ root: session, fingerprint });
    await writeFile(join(session, 'inner.txt'), 'inner, edited\n');
    const after = await captureWorkspaceFingerprint(session);
    if (!after) throw new Error('expected a git work tree');
    const captured = await capturer.captureChanges({
      root: session,
      changedPaths: diffWorkspaceFingerprints(fingerprint, after),
      before,
    });
    expect(captured.receipts[0]?.relativePath).toBe('inner.txt');
    expect(await bytesOf(store, captured.receipts[0]?.beforeSha ?? null)).toBe('inner\n');
  });

  it('treats every new file as absent before in a repository without commits', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'piwin-cmd-fresh-'));
    try {
      git(fresh, 'init', '-q');
      const fingerprint = (await captureWorkspaceFingerprint(fresh)) ?? new Map<string, string>();
      const before = await capturer.snapshotBefore({ root: fresh, fingerprint });
      await writeFile(join(fresh, 'first.txt'), 'hello\n');
      const after = await captureWorkspaceFingerprint(fresh);
      if (!after) throw new Error('expected a git work tree');
      const captured = await capturer.captureChanges({
        root: fresh,
        changedPaths: diffWorkspaceFingerprints(fingerprint, after),
        before,
      });
      expect(captured.receipts[0]).toMatchObject({ relativePath: 'first.txt', beforeExists: false });
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});
