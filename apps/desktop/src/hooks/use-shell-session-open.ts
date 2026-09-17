export type ShellSessionOpen = (sessionId: string) => Promise<void>;

/** Non-frozen; AN-X1 replaces this shape from the workbench-app closure. */
export type ShellSessionOpenArgs = object;

export function useShellSessionOpen(args: ShellSessionOpenArgs): ShellSessionOpen {
  void args;
  throw new Error('AN-X1 not implemented');
}
