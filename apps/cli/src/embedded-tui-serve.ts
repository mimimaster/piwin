import type { EmbeddedTuiPorts } from '@piwin/host-runtime';
import type { LocalShellAccessData } from '@piwin/contracts';

/**
 * How `host serve` starts its own CLI again: the same Node binary, loader
 * flags (tsx in development) and entry script. Debugger flags are dropped so
 * a child never fights the Host for an inspector port.
 */
export function sidecarCliInvocation(input: {
  execPath: string;
  execArgv: readonly string[];
  argv: readonly string[];
}): EmbeddedTuiPorts['invocation'] | undefined {
  const entry = input.argv[1];
  if (entry === undefined || entry.length === 0) return undefined;
  const flags = input.execArgv.filter((flag) => !/^--inspect(?:-brk|-port|-wait)?(?:=|$)/.test(flag));
  return { program: input.execPath, args: [...flags, entry] };
}

/** ADR 0102: the sidecar runs the terminal shell for phones through its loopback entrance. */
export function sidecarEmbeddedTuiPorts(
  openLoopbackEntrance: () => Promise<LocalShellAccessData>,
): EmbeddedTuiPorts | undefined {
  const invocation = sidecarCliInvocation({
    execPath: process.execPath,
    execArgv: process.execArgv,
    argv: process.argv,
  });
  return invocation === undefined ? undefined : { openLoopbackEntrance, invocation };
}
