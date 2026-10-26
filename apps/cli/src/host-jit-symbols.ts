import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const SYMBOL_MAP_FILE = /^perf-(\d+)\.map$/;

/**
 * Where V8 writes the Host's `perf-<pid>.map`. Desktop passes this directory
 * to the packaged macOS Host at launch (`host_bridge/jit_symbols.rs`); the two
 * must match. Only piwin Hosts write here, so pruning it is safe.
 */
export function hostJitSymbolsDirectory(diagnosticsDir: string): string {
  return join(diagnosticsDir, 'jit-symbols');
}

export function hostJitSymbolMapPath(diagnosticsDir: string, pid: number): string {
  return join(hostJitSymbolsDirectory(diagnosticsDir), `perf-${pid}.map`);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the pid exists but belongs to someone else.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/**
 * Delete symbol maps left by Hosts that have exited. A map grows for the whole
 * life of its Host and is useless once the process is gone, because the
 * watchdog symbolizes each sample as soon as it is taken.
 */
export function pruneHostJitSymbolMaps(
  directory: string,
  currentPid: number,
  isAlive: (pid: number) => boolean = isProcessAlive,
): number {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const name of names) {
    const pid = Number(SYMBOL_MAP_FILE.exec(name)?.[1]);
    if (!Number.isInteger(pid) || pid === currentPid || isAlive(pid)) continue;
    unlinkSync(join(directory, name));
    removed += 1;
  }
  return removed;
}
