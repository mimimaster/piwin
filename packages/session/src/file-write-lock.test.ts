import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';

const LOCK_MODULE_URL = new URL('./file-write-lock.ts', import.meta.url).href;

function startLockProcess(
  filePath: string,
  holdUntilInput: boolean,
): ChildProcessWithoutNullStreams {
  const holdCode = holdUntilInput
    ? "await new Promise((resolve) => process.stdin.once('data', () => resolve()));"
    : 'await new Promise((resolve) => setTimeout(resolve, 10));';
  const script = [
    `import { withFileWriteLock } from ${JSON.stringify(LOCK_MODULE_URL)};`,
    '(async () => {',
    `  await withFileWriteLock(${JSON.stringify(filePath)}, async () => {`,
    "    console.log('acquired');",
    `    ${holdCode}`,
    '  });',
    '})().catch((error) => {',
    '  console.error(error);',
    '  process.exitCode = 1;',
    '});',
  ].join('\n');
  return spawn(
    process.execPath,
    ['--import', 'tsx/esm', '--input-type=module', '-e', script],
    { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

function startCounterProcess(
  filePath: string,
  increments: number,
): ChildProcessWithoutNullStreams {
  const script = [
    `import { readFile, writeFile } from 'node:fs/promises';`,
    `import { withFileWriteLock } from ${JSON.stringify(LOCK_MODULE_URL)};`,
    '(async () => {',
    `  for (let index = 0; index < ${increments}; index += 1) {`,
    `    await withFileWriteLock(${JSON.stringify(filePath)}, async () => {`,
    `      const raw = await readFile(${JSON.stringify(filePath)}, 'utf8');`,
    '      const current = JSON.parse(raw);',
    '      await new Promise((resolve) => setTimeout(resolve, 2));',
    '      const count = typeof current.count === \'number\' ? current.count : 0;',
    `      await writeFile(${JSON.stringify(filePath)}, JSON.stringify({ count: count + 1 }), 'utf8');`,
    '    });',
    '  }',
    "  console.log('done');",
    '})().catch((error) => {',
    '  console.error(error);',
    '  process.exitCode = 1;',
    '});',
  ].join('\n');
  return spawn(
    process.execPath,
    ['--import', 'tsx/esm', '--input-type=module', '-e', script],
    { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

function waitForMarker(
  child: ChildProcessWithoutNullStreams,
  marker: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const onData = (chunk: Uint8Array | string): void => {
      output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      if (output.includes(marker)) {
        finish();
        resolve();
      }
    };
    const onError = (error: Error): void => {
      finish();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      finish();
      reject(new Error(`child exited before ${marker}: code=${code} signal=${signal}\n${output}`));
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      child.stdout.removeListener('data', onData);
      child.stderr.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
}

describe('file write lock', () => {
  it('serializes the same path across independent Node processes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-file-lock-process-'));
    const filePath = join(directory, 'plan.json');
    const holder = startLockProcess(filePath, true);
    let contender: ChildProcessWithoutNullStreams | undefined;
    try {
      await waitForMarker(holder, 'acquired');
      contender = startLockProcess(filePath, false);
      const contenderAcquired = waitForMarker(contender, 'acquired');
      const state = await Promise.race([
        contenderAcquired.then(() => 'acquired' as const),
        delay(80).then(() => 'waiting' as const),
      ]);
      expect(state).toBe('waiting');

      holder.stdin.end('release');
      await contenderAcquired;
      expect(await waitForExit(holder)).toBe(0);
      expect(await waitForExit(contender)).toBe(0);
    } finally {
      for (const child of [holder, contender]) {
        if (child && child.exitCode === null) child.kill();
      }
    }
  });

  it('keeps independent-process read-modify-write increments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-file-lock-rmw-'));
    const filePath = join(directory, 'counter.json');
    await writeFile(filePath, JSON.stringify({ count: 0 }), 'utf8');
    const writers = [startCounterProcess(filePath, 8), startCounterProcess(filePath, 8)];
    try {
      await Promise.all(writers.map((writer) => waitForMarker(writer, 'done')));
      for (const writer of writers) {
        expect(await waitForExit(writer)).toBe(0);
      }
      const result = JSON.parse(await readFile(filePath, 'utf8')) as { count?: unknown };
      expect(result.count).toBe(16);
    } finally {
      for (const writer of writers) {
        if (writer.exitCode === null) writer.kill();
      }
    }
  });
});
