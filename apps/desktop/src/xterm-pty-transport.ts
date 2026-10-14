import {
  listenTauriPtyData, listenTauriPtyExit, tauriPtyClose, tauriPtyResize, tauriPtyWrite,
  type TauriPtyDataEvent, type TauriPtyExitEvent, type TauriPtyOpenResult,
} from './tauri-pty.js';

/** xterm I/O port; native Desktop PTYs and Host-owned agent PTYs share rendering. */
export type XtermPtyDataEvent = TauriPtyDataEvent & { sequence?: number };
export type XtermPtyTransport = {
  listenData: (handler: (event: XtermPtyDataEvent) => void) => Promise<() => void>;
  listenExit: (handler: (event: TauriPtyExitEvent) => void) => Promise<() => void>;
  write: (ptyId: string, data: string) => Promise<void>;
  resize: (ptyId: string, cols: number, rows: number) => Promise<void>;
  close: (ptyId: string) => Promise<void>;
};
export type XtermPtyOpenResult = TauriPtyOpenResult & { initial_output?: string; output_through?: number };
export type XtermPty = { transport: XtermPtyTransport; open: (size: { cols: number; rows: number }) => Promise<XtermPtyOpenResult> };

export const TAURI_PTY_TRANSPORT: XtermPtyTransport = {
  listenData: listenTauriPtyData, listenExit: listenTauriPtyExit,
  write: tauriPtyWrite, resize: tauriPtyResize, close: tauriPtyClose,
};
