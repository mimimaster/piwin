import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOST_HANG_WATCHDOG_WORKER_SOURCE } from './host-hang-watchdog-worker-source.js';
import { HOST_JIT_SYMBOLIZER_SOURCE } from './host-jit-symbolizer-source.js';
import {
  hostJitSymbolMapPath,
  hostJitSymbolsDirectory,
  pruneHostJitSymbolMaps,
} from './host-jit-symbols.js';

type SymbolizeResult = { text: string; resolved: number; culprit: string | undefined };
type Symbolize = (sampleText: string, mapText: string) => SymbolizeResult;

function loadSymbolizer(): Symbolize {
  // Same evaluation the watchdog worker performs on this source.
  return new Function(`${HOST_JIT_SYMBOLIZER_SOURCE}\nreturn symbolizeHangSample;`)() as Symbolize;
}

// Shape of macOS `sample` output for a main thread stuck in a regex after an
// awaited readFile, plus an idle second thread.
const SAMPLE = [
  'Call graph:',
  '    2501 Thread_39838811   DispatchQueue_1: com.apple.main-thread  (serial)',
  '    + 2501 start  (in dyld) + 6992  [0x18ea4be00]',
  '    +   2501 Builtins_AsyncFunctionAwaitResolveClosure  (in piwin-host) + 80  [0x105a5d410]',
  '    +     2501 ???  (in <unknown binary>)  [0x111090064]',
  '    +       2501 Builtins_RegExpPrototypeTestFast  (in piwin-host) + 744  [0x105b3d028]',
  '    +         705 ???  (in <unknown binary>)  [0x110f23118]',
  '    +         695 ???  (in <unknown binary>)  [0x110f2319c]',
  '    2501 Thread_39838885: DelayedTaskSchedulerWorker',
  '    + 2501 ???  (in <unknown binary>)  [0x1200000a0]',
].join('\n');

const SYMBOL_MAP = [
  // An earlier compile of the culprit; the later, overlapping line wins.
  '111090000 100 JS:~stale file:///host/old.mjs:1:1',
  '111090000 100 JS:*classifyExtensionSource file:///host/cli-chunk.mjs:42:7',
  '110f23000 400 RegExp:\\bsetWidget\\s*\\(',
  '120000000 200 JS:~workerIdle file:///host/worker.mjs:3:1',
  'not a map line',
].join('\n');

describe('host JIT symbols', () => {
  it('names JIT frames and reports the hottest deepest main-thread frame', () => {
    const result = loadSymbolizer()(SAMPLE, SYMBOL_MAP);
    expect(result.resolved).toBe(4);
    expect(result.text).toContain(
      '2501 JS:*classifyExtensionSource file:///host/cli-chunk.mjs:42:7  (in <jit>)  [0x111090064]',
    );
    expect(result.text).toContain('705 RegExp:\\bsetWidget\\s*\\(  (in <jit>)  [0x110f23118]');
    expect(result.text).not.toContain('???');
    // The regex frames have fewer samples; the worker thread is not the main thread.
    expect(result.culprit).toBe('JS:*classifyExtensionSource file:///host/cli-chunk.mjs:42:7');
  });

  it('leaves a sample untouched when nothing matches the map', () => {
    const result = loadSymbolizer()(SAMPLE, '1000 10 JS:~elsewhere file:///x.mjs:1:1');
    expect(result).toEqual({ text: SAMPLE, resolved: 0, culprit: undefined });
  });

  it('splices into a worker source that parses', () => {
    expect(HOST_HANG_WATCHDOG_WORKER_SOURCE).toContain('function symbolizeHangSample(');
    expect(() => new Function(HOST_HANG_WATCHDOG_WORKER_SOURCE)).not.toThrow();
  });

  it('prunes maps of exited Hosts only', async () => {
    const diagnostics = await mkdtemp(join(tmpdir(), 'piwin-jit-symbols-'));
    const directory = hostJitSymbolsDirectory(diagnostics);
    expect(hostJitSymbolMapPath(diagnostics, 7)).toBe(join(directory, 'perf-7.map'));
    expect(pruneHostJitSymbolMaps(directory, 7)).toBe(0);

    await mkdir(directory, { recursive: true });
    for (const name of ['perf-7.map', 'perf-8.map', 'perf-9.map', 'notes.txt']) {
      await writeFile(join(directory, name), 'x');
    }
    const alive = new Set([8]);
    expect(pruneHostJitSymbolMaps(directory, 7, (pid) => alive.has(pid))).toBe(1);
    expect((await readdir(directory)).sort()).toEqual(['notes.txt', 'perf-7.map', 'perf-8.map']);
  });
});
