import {
  type TauriPtyExitEvent,
} from './tauri-pty.js';
import { TAURI_PTY_TRANSPORT, type XtermPtyTransport, type XtermPtyOpenResult, type XtermPtyDataEvent } from './xterm-pty-transport.js';

type StartupEvent =
  | { kind: 'data'; payload: XtermPtyDataEvent }
  | { kind: 'exit'; payload: TauriPtyExitEvent };

/** Startup events may arrive before invoke resolves with the PTY id. */
const MAX_STARTUP_BYTES = 1024 * 1024;
const MAX_STARTUP_EVENTS = 1024;

export async function connectXtermPty(input: {
  signal: AbortSignal;
  transport?: XtermPtyTransport;
  open: () => Promise<XtermPtyOpenResult>;
  onOpen: (ptyId: string) => void;
  onData: (data: string) => void;
  onExit: (event: TauriPtyExitEvent) => void;
}): Promise<void> {
  if (input.signal.aborted) return;
  const transport = input.transport ?? TAURI_PTY_TRANSPORT;
  let disposed = false;
  let opening = false;
  let ptyId: string | undefined;
  let bufferedBytes = 0;
  const pending: StartupEvent[] = [];
  const listeners: Array<() => void> = [];
  const close = (id: string): void => {
    void transport.close(id).catch((error: unknown) => {
      console.warn('[terminal] PTY close failed', error);
    });
  };
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const unlisten of listeners) unlisten();
    listeners.length = 0;
    pending.length = 0;
    input.signal.removeEventListener('abort', dispose);
    if (ptyId !== undefined) close(ptyId);
  };
  input.signal.addEventListener('abort', dispose, { once: true });

  const receive = (event: StartupEvent): void => {
    if (disposed) return;
    if (ptyId === undefined) {
      if (!opening) return;
      const bytes = event.kind === 'data' ? event.payload.data.length * 2 : 0;
      // Other open terminals share this event stream, so bound startup memory.
      if (pending.length < MAX_STARTUP_EVENTS && bufferedBytes + bytes <= MAX_STARTUP_BYTES) {
        pending.push(event);
        bufferedBytes += bytes;
      }
      return;
    }
    if (event.payload.pty_id !== ptyId) return;
    if (event.kind === 'data') input.onData(event.payload.data);
    else input.onExit(event.payload);
  };
  const retain = (unlisten: () => void): boolean => {
    if (disposed) {
      unlisten();
      return false;
    }
    listeners.push(unlisten);
    return true;
  };

  try {
    if (!retain(await transport.listenData((payload) => receive({ kind: 'data', payload })))) return;
    if (!retain(await transport.listenExit((payload) => receive({ kind: 'exit', payload })))) return;
    opening = true;
    const opened = await input.open();
    if (disposed) {
      close(opened.pty_id);
      return;
    }
    ptyId = opened.pty_id;
    input.onOpen(ptyId);
    if (opened.initial_output !== undefined) input.onData(opened.initial_output);
    for (const event of pending) {
      if (event.kind === 'data' && event.payload.pty_id === ptyId && event.payload.sequence !== undefined &&
          opened.initial_output !== undefined && opened.output_through !== undefined && event.payload.sequence <= opened.output_through) continue;
      receive(event);
    }
    pending.length = 0;
  } catch (error) {
    dispose();
    if (!input.signal.aborted) throw error;
  }
}
