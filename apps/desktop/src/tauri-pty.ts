/**
 * Desktop-owned interactive PTY (ADR 0013).
 * Uses Tauri invoke/events — never routes bytes through Node host JSONL.
 */

export type TauriPtyOpenResult = {
  pty_id: string;
};

export type TauriPtyDataEvent = {
  pty_id: string;
  data: string;
};

export type TauriPtyExitEvent = {
  pty_id: string;
  exit_code?: number | null;
};

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** True when we should prefer Tauri PTY + xterm over host shell preview. */
export function isTauriPtyAvailable(): boolean {
  return isTauriRuntime();
}

export async function tauriPtyOpen(input: {
  cwd: string;
  /** Trusted project root used for host authorization (required for spawn). */
  projectPath?: string;
  cols?: number;
  rows?: number;
}): Promise<TauriPtyOpenResult> {
  const { invoke } = await import('@tauri-apps/api/core');
  const payload: {
    cwd: string;
    projectPath?: string;
    cols?: number;
    rows?: number;
  } = { cwd: input.cwd };
  if (input.projectPath) payload.projectPath = input.projectPath;
  if (typeof input.cols === 'number') payload.cols = input.cols;
  if (typeof input.rows === 'number') payload.rows = input.rows;
  return invoke<TauriPtyOpenResult>('pty_open', payload);
}

export async function tauriPtyWrite(ptyId: string, data: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('pty_write', { ptyId, data });
}

export async function tauriPtyResize(ptyId: string, cols: number, rows: number): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('pty_resize', { ptyId, cols, rows });
}

export async function tauriPtyClose(ptyId: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('pty_close', { ptyId });
}

export async function tauriPtyCloseAll(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('pty_close_all');
}

export async function listenTauriPtyData(
  handler: (event: TauriPtyDataEvent) => void,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<TauriPtyDataEvent>('pty_data', (event) => {
    handler(event.payload);
  });
  return unlisten;
}

export async function listenTauriPtyExit(
  handler: (event: TauriPtyExitEvent) => void,
): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<TauriPtyExitEvent>('pty_exit', (event) => {
    handler(event.payload);
  });
  return unlisten;
}
